import json
from datetime import UTC, datetime
from decimal import Decimal

import asyncpg

from .config import AgentConfig


class AgentNotFoundError(LookupError):
    pass


class AgentArchivedError(AgentNotFoundError):
    pass


class TenantUsageLimitError(RuntimeError):
    pass


async def fetch_agent_config(
    conn: asyncpg.Connection, agent_slug: str, tenant_slug: str = "default"
) -> AgentConfig:
    row = await conn.fetchrow(
        """
        select a.config, a.archived_at
        from agents a
        join tenants t on t.id = a.tenant_id
        where t.slug = $1 and a.slug = $2
        """,
        tenant_slug,
        agent_slug,
    )
    if row is None:
        raise AgentNotFoundError(f"agent {tenant_slug}/{agent_slug} not found")
    if row["archived_at"] is not None:
        raise AgentArchivedError(f"agent {tenant_slug}/{agent_slug} is archived")
    return AgentConfig.model_validate(json.loads(row["config"]))


async def fetch_provider_credentials(conn: asyncpg.Connection, tenant_slug: str) -> dict[str, str]:
    rows = await conn.fetch(
        """
        select pc.provider, pc.encrypted_key
        from provider_credentials pc
        join tenants t on t.id = pc.tenant_id
        where t.slug = $1
        """,
        tenant_slug,
    )
    return {row["provider"]: row["encrypted_key"] for row in rows}


async def assert_tenant_usage_available(conn: asyncpg.Connection, tenant_slug: str) -> None:
    now = datetime.now(UTC)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period_start.month == 12:
        period_end = period_start.replace(year=period_start.year + 1, month=1)
    else:
        period_end = period_start.replace(month=period_start.month + 1)
    row = await conn.fetchrow(
        """
        select
          t.monthly_call_minutes_limit,
          t.monthly_provider_spend_limit_usd,
          coalesce(sum(extract(epoch from (
            least(coalesce(c.ended_at, $3), $2) - greatest(c.started_at, $1)
          ))), 0) as call_seconds,
          coalesce(sum(case
            when c.started_at >= $1 and c.started_at < $2 then c.cost_usd
            else 0
          end), 0) + coalesce((
            select sum(er.cost_usd)
            from eval_runs er
            where er.tenant_id = t.id and er.created_at >= $1 and er.created_at < $2
          ), 0) as provider_spend_usd
        from tenants t
        left join calls c
          on c.tenant_id = t.id
          and c.started_at < $2
          and coalesce(c.ended_at, $3) > $1
        where t.slug = $4
        group by t.id
        """,
        period_start,
        period_end,
        now,
        tenant_slug,
    )
    if row is None:
        return
    call_limit = row["monthly_call_minutes_limit"]
    if call_limit is not None and float(row["call_seconds"]) / 60 >= call_limit:
        raise TenantUsageLimitError("Workspace monthly call-minute limit reached")
    spend_limit = row["monthly_provider_spend_limit_usd"]
    if spend_limit is not None and Decimal(row["provider_spend_usd"]) >= spend_limit:
        raise TenantUsageLimitError("Workspace monthly provider-spend limit reached")
