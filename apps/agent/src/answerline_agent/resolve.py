import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

import asyncpg
from answerline_llm import decrypt_provider_credential
from pydantic import ValidationError

from .call_dispatch import CallDispatchMetadata
from .config import AgentConfig, load_agent_config
from .db import (
    AgentArchivedError,
    AgentNotFoundError,
    assert_tenant_usage_available,
    fetch_agent_config,
    fetch_provider_credentials,
)
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
    provider_keys: dict[str, str]
    source: Literal["database", "yaml"]
    language: str | None = None


def deployment_provider_keys(settings: Settings) -> dict[str, str]:
    fields = {
        "anthropic": settings.anthropic_api_key,
        "cartesia": settings.cartesia_api_key,
        "deepgram": settings.deepgram_api_key,
        "deepseek": settings.deepseek_api_key,
        "google": settings.google_api_key,
        "openai": settings.openai_api_key,
        "openrouter": settings.openrouter_api_key,
    }
    return {
        provider: key.get_secret_value()
        for provider, key in fields.items()
        if key is not None and key.get_secret_value().strip()
    }


def merge_provider_keys(encrypted_keys: dict[str, str], settings: Settings) -> dict[str, str]:
    provider_keys = deployment_provider_keys(settings)
    if encrypted_keys:
        if settings.provider_keys_encryption_key is None:
            raise ValueError(
                "PROVIDER_KEYS_ENCRYPTION_KEY is required to use workspace provider keys"
            )
        encryption_key = settings.provider_keys_encryption_key.get_secret_value()
        provider_keys.update(
            {
                provider: decrypt_provider_credential(encrypted, encryption_key)
                for provider, encrypted in encrypted_keys.items()
            }
        )
    return provider_keys


async def _load_from_database(
    database_url: str, slug: str, tenant: str, settings: Settings
) -> tuple[AgentConfig, dict[str, str]]:
    conn = await asyncpg.connect(database_url, timeout=DB_CONNECT_TIMEOUT)
    try:
        config = await fetch_agent_config(conn, slug, tenant)
        await assert_tenant_usage_available(conn, tenant)
        encrypted_keys = await fetch_provider_credentials(conn, tenant)
        return config, merge_provider_keys(encrypted_keys, settings)
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
        config, provider_keys = await _load_from_database(
            settings.database_url, slug, tenant, settings
        )
        return ResolvedAgent(
            slug=slug,
            tenant=tenant,
            config=config,
            provider_keys=provider_keys,
            source="database",
            language=dispatch.language,
        )

    if settings.database_url:
        try:
            config, provider_keys = await _load_from_database(
                settings.database_url, slug, tenant, settings
            )
        except AgentArchivedError:
            raise
        except AgentNotFoundError:
            logger.info("agent %s/%s not in database, trying yaml", tenant, slug)
        except (OSError, asyncpg.PostgresError, ValidationError, TimeoutError):
            logger.warning("database lookup for agent %s failed, trying yaml", slug, exc_info=True)
        else:
            return ResolvedAgent(
                slug=slug,
                tenant=tenant,
                config=config,
                provider_keys=provider_keys,
                source="database",
                language=dispatch.language,
            )

    path = settings.agents_dir / f"{slug}.yaml"
    if not path.is_file():
        raise AgentConfigNotFoundError(f"agent {slug} not found in database or at {path}")
    config = await asyncio.to_thread(load_agent_config, path)
    logger.info("loaded agent %s from %s", slug, path)
    return ResolvedAgent(
        slug=slug,
        tenant=tenant,
        config=config,
        provider_keys=deployment_provider_keys(settings),
        source="yaml",
        language=dispatch.language,
    )
