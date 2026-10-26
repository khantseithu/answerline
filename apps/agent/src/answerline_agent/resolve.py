import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

import asyncpg
from pydantic import ValidationError

from .call_dispatch import CallDispatchMetadata
from .config import AgentConfig, load_agent_config
from .db import AgentArchivedError, AgentNotFoundError, fetch_agent_config
from .settings import Settings

logger = logging.getLogger("answerline.agent")
DB_CONNECT_TIMEOUT = 5.0


class AgentConfigNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class ResolvedAgent:
    slug: str
    tenant: str
    config: AgentConfig
    source: Literal["database", "yaml"]


async def _load_from_database(database_url: str, slug: str, tenant: str) -> AgentConfig:
    conn = await asyncpg.connect(database_url, timeout=DB_CONNECT_TIMEOUT)
    try:
        return await fetch_agent_config(conn, slug, tenant)
    finally:
        await conn.close()


async def resolve_agent(metadata: str | None, settings: Settings) -> ResolvedAgent:
    dispatch = (
        CallDispatchMetadata.model_validate_json(metadata)
        if metadata
        else CallDispatchMetadata(agent=settings.default_agent, tenant=settings.tenant)
    )
    slug, tenant = dispatch.agent, dispatch.tenant
    if metadata:
        if not settings.database_url:
            raise AgentConfigNotFoundError("workspace dispatch requires a database")
        config = await _load_from_database(settings.database_url, slug, tenant)
        return ResolvedAgent(slug=slug, tenant=tenant, config=config, source="database")

    if settings.database_url:
        try:
            config = await _load_from_database(settings.database_url, slug, tenant)
        except AgentArchivedError:
            raise
        except AgentNotFoundError:
            logger.info("agent %s/%s not in database, trying yaml", tenant, slug)
        except (OSError, asyncpg.PostgresError, ValidationError, TimeoutError):
            logger.warning("database lookup for agent %s failed, trying yaml", slug, exc_info=True)
        else:
            return ResolvedAgent(slug=slug, tenant=tenant, config=config, source="database")

    path = settings.agents_dir / f"{slug}.yaml"
    if not path.is_file():
        raise AgentConfigNotFoundError(f"agent {slug} not found in database or at {path}")
    config = await asyncio.to_thread(load_agent_config, path)
    logger.info("loaded agent %s from %s", slug, path)
    return ResolvedAgent(slug=slug, tenant=tenant, config=config, source="yaml")
