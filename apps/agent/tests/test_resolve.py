import asyncio
import json
import os
import uuid

import asyncpg
import pytest
from answerline_agent import resolve
from answerline_agent.config import AgentConfig
from answerline_agent.db import AgentNotFoundError
from answerline_agent.resolve import (
    AgentConfigNotFoundError,
    parse_agent_slug,
    resolve_agent,
)
from answerline_agent.settings import DEFAULT_AGENTS_DIR, Settings

DEFAULT = "bright-smile-dental"

CONFIG = {
    "name": "Database Clinic",
    "greeting": "Hello",
    "instructions": "Be brief.",
    "models": {
        "stt": "deepgram/nova-3",
        "llm": {"primary": "anthropic/claude-sonnet-4-6"},
        "tts": "cartesia/sonic-3",
    },
}


def _settings(database_url: str | None = None) -> Settings:
    return Settings(_env_file=None, agents_dir=DEFAULT_AGENTS_DIR, database_url=database_url)


def _fake_database(monkeypatch, result):
    calls = []

    async def fake(database_url, slug):
        calls.append((database_url, slug))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(resolve, "_load_from_database", fake)
    return calls


def test_parse_slug_from_metadata():
    assert parse_agent_slug(json.dumps({"agent": "acme-2"}), DEFAULT) == "acme-2"


@pytest.mark.parametrize(
    "metadata",
    [
        None,
        "",
        "{}",
        "not json",
        "[]",
        "null",
        json.dumps({"agent": None}),
        json.dumps({"agent": 7}),
        json.dumps({"agent": ""}),
        json.dumps({"agent": "Upper"}),
        json.dumps({"agent": "-leading"}),
        json.dumps({"agent": "../etc/passwd"}),
        json.dumps({"agent": "a" * 64}),
    ],
)
def test_parse_slug_falls_back_to_default(metadata):
    assert parse_agent_slug(metadata, DEFAULT) == DEFAULT


def test_parse_slug_accepts_max_length():
    slug = "a" * 63
    assert parse_agent_slug(json.dumps({"agent": slug}), DEFAULT) == slug


def test_database_hit_skips_yaml(monkeypatch):
    config = AgentConfig.model_validate(CONFIG)
    calls = _fake_database(monkeypatch, config)
    settings = _settings(database_url="postgres://db")
    resolved = asyncio.run(resolve_agent(json.dumps({"agent": DEFAULT}), settings))
    assert resolved.source == "database"
    assert resolved.config.name == "Database Clinic"
    assert calls == [("postgres://db", DEFAULT)]


def test_database_miss_falls_back_to_yaml(monkeypatch):
    _fake_database(monkeypatch, AgentNotFoundError("missing"))
    settings = _settings(database_url="postgres://db")
    resolved = asyncio.run(resolve_agent(json.dumps({"agent": DEFAULT}), settings))
    assert resolved.source == "yaml"
    assert resolved.config.name == "Bright Smile Dental"


def test_database_error_falls_back_to_yaml(monkeypatch):
    _fake_database(monkeypatch, ConnectionRefusedError())
    settings = _settings(database_url="postgres://db")
    resolved = asyncio.run(resolve_agent(None, settings))
    assert resolved.source == "yaml"
    assert resolved.slug == DEFAULT


def test_no_database_uses_yaml(monkeypatch):
    calls = _fake_database(monkeypatch, AssertionError("should not be called"))
    resolved = asyncio.run(resolve_agent(None, _settings()))
    assert resolved.source == "yaml"
    assert calls == []


def test_unknown_slug_raises(monkeypatch):
    _fake_database(monkeypatch, AgentNotFoundError("missing"))
    settings = _settings(database_url="postgres://db")
    with pytest.raises(AgentConfigNotFoundError, match="no-such-agent"):
        asyncio.run(resolve_agent(json.dumps({"agent": "no-such-agent"}), settings))


def test_agents_dir_is_not_cwd_relative(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert DEFAULT_AGENTS_DIR.is_absolute()
    assert (DEFAULT_AGENTS_DIR / f"{DEFAULT}.yaml").is_file()


DATABASE_URL = os.environ.get("DATABASE_URL")


async def _database_roundtrip() -> None:
    slug = f"test-{uuid.uuid4().hex[:12]}"
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        tenant_id = await conn.fetchval(
            "insert into tenants (slug, name) values ('default', 'Default') "
            "on conflict (slug) do update set slug = excluded.slug returning id"
        )
        await conn.execute(
            "insert into agents (tenant_id, slug, name, config) values ($1, $2, $3, $4)",
            tenant_id,
            slug,
            CONFIG["name"],
            json.dumps(CONFIG),
        )
        settings = _settings(database_url=DATABASE_URL)
        hit = await resolve_agent(json.dumps({"agent": slug}), settings)
        assert hit.source == "database"
        assert hit.config.name == "Database Clinic"
        miss = await resolve_agent(json.dumps({"agent": DEFAULT}), settings)
        assert miss.config.name == "Bright Smile Dental"
        assert miss.slug == DEFAULT
    finally:
        await conn.execute("delete from agents where slug = $1", slug)
        await conn.close()


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_resolve_against_postgres():
    asyncio.run(_database_roundtrip())
