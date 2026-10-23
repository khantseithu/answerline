import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Literal

import asyncpg
from pydantic import ValidationError

from .config import AgentConfig, load_agent_config
from .db import AgentNotFoundError, fetch_agent_config
from .settings import Settings

logger = logging.getLogger("answerline.agent")

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
DB_CONNECT_TIMEOUT = 5.0


class AgentConfigNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class ResolvedAgent:
    slug: str
    config: AgentConfig
    source: Literal["database", "yaml"]


def parse_agent_slug(metadata: str | None, default: str) -> str:
    if not metadata:
        return default
    try:
        payload = json.loads(metadata)
    except ValueError:
        logger.warning("dispatch metadata is not valid JSON, using default agent")
        return default
    slug = payload.get("agent") if isinstance(payload, dict) else None
    if slug is None:
        return default
    if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug):
        logger.warning("dispatch metadata has an invalid agent slug, using default agent")
        return default
    return slug


async def _load_from_database(database_url: str, slug: str, tenant: str) -> AgentConfig:
    conn = await asyncpg.connect(database_url, timeout=DB_CONNECT_TIMEOUT)
    try:
        return await fetch_agent_config(conn, slug, tenant)
    finally:
        await conn.close()


async def resolve_agent(metadata: str | None, settings: Settings) -> ResolvedAgent:
    slug = parse_agent_slug(metadata, settings.default_agent)

    if settings.database_url:
        try:
            config = await _load_from_database(settings.database_url, slug, settings.tenant)
        except AgentNotFoundError:
            logger.info("agent %s not in database, trying yaml", slug)
        except (OSError, asyncpg.PostgresError, ValidationError, TimeoutError):
            logger.warning("database lookup for agent %s failed, trying yaml", slug, exc_info=True)
        else:
            logger.info("loaded agent %s from database", slug)
            return ResolvedAgent(slug=slug, config=config, source="database")

    path = settings.agents_dir / f"{slug}.yaml"
    if not path.is_file():
        raise AgentConfigNotFoundError(f"agent {slug} not found in database or at {path}")
    config = await asyncio.to_thread(load_agent_config, path)
    logger.info("loaded agent %s from %s", slug, path)
    return ResolvedAgent(slug=slug, config=config, source="yaml")
