import json

import asyncpg

from .config import AgentConfig


class AgentNotFoundError(LookupError):
    pass


async def fetch_agent_config(
    conn: asyncpg.Connection, agent_slug: str, tenant_slug: str = "default"
) -> AgentConfig:
    row = await conn.fetchrow(
        """
        select a.config
        from agents a
        join tenants t on t.id = a.tenant_id
        where t.slug = $1 and a.slug = $2
        """,
        tenant_slug,
        agent_slug,
    )
    if row is None:
        raise AgentNotFoundError(f"agent {tenant_slug}/{agent_slug} not found")
    return AgentConfig.model_validate(json.loads(row["config"]))
