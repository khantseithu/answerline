import asyncio
import json
import os
import uuid

import asyncpg
import pytest
from answerline_agent.db import AgentArchivedError, AgentNotFoundError, fetch_agent_config

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

CONFIG = {
    "name": "Test Clinic",
    "greeting": "Hello",
    "instructions": "Be brief.",
    "models": {
        "stt": "deepgram/nova-3",
        "llm": {"primary": "anthropic/claude-sonnet-4-6"},
        "tts": "cartesia/sonic-3",
    },
}


async def _roundtrip() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    tenant_slug = f"test-{uuid.uuid4()}"
    try:
        tenant_id = await conn.fetchval(
            "insert into tenants (slug, name) values ($1, $1) returning id", tenant_slug
        )
        await conn.execute(
            "insert into agents (tenant_id, slug, name, config) values ($1, 'clinic', $2, $3)",
            tenant_id,
            CONFIG["name"],
            json.dumps(CONFIG),
        )
        config = await fetch_agent_config(conn, "clinic", tenant_slug)
        assert config.name == "Test Clinic"
        assert config.models.llm.fallback == []
        with pytest.raises(AgentNotFoundError):
            await fetch_agent_config(conn, "missing", tenant_slug)
        await conn.execute("update agents set archived_at = now() where slug = $1", "clinic")
        with pytest.raises(AgentArchivedError):
            await fetch_agent_config(conn, "clinic", tenant_slug)
    finally:
        await conn.execute("delete from tenants where slug = $1", tenant_slug)
        await conn.close()


def test_fetch_agent_config_from_db():
    asyncio.run(_roundtrip())
