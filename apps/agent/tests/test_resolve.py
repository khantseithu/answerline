import asyncio
import json
import os
import uuid

import asyncpg
import pytest
from answerline_agent import resolve
from answerline_agent.config import AgentConfig
from answerline_agent.db import AgentArchivedError, AgentNotFoundError
from answerline_agent.resolve import (
    AgentConfigNotFoundError,
    resolve_agent,
)
from answerline_agent.settings import DEFAULT_AGENTS_DIR, Settings
from pydantic import ValidationError

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


def _settings(database_url: str | None = None, tenant: str = "default") -> Settings:
    return Settings(
        _env_file=None, agents_dir=DEFAULT_AGENTS_DIR, database_url=database_url, tenant=tenant
    )


def _fake_database(monkeypatch, result):
    calls = []

    async def fake(database_url, slug, tenant):
        calls.append((database_url, slug, tenant))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(resolve, "_load_from_database", fake)
    return calls


@pytest.mark.parametrize(
    "metadata",
    [
        "{}",
        "not json",
        "[]",
        "null",
        json.dumps({"agent": DEFAULT}),
        json.dumps({"agent": "../etc", "tenant": "default"}),
        json.dumps({"agent": DEFAULT, "tenant": "default", "extra": True}),
    ],
)
def test_explicit_invalid_metadata_fails_closed(monkeypatch, metadata):
    calls = _fake_database(monkeypatch, AgentConfig.model_validate(CONFIG))
    with pytest.raises(ValidationError):
        asyncio.run(resolve_agent(metadata, _settings(database_url="postgres://db")))
    assert calls == []


def test_database_hit_skips_yaml_and_uses_dispatched_tenant(monkeypatch):
    calls = _fake_database(monkeypatch, AgentConfig.model_validate(CONFIG))
    settings = _settings(database_url="postgres://db", tenant="deployment")
    resolved = asyncio.run(
        resolve_agent(json.dumps({"agent": DEFAULT, "tenant": "workspace-two"}), settings)
    )
    assert resolved.source == "database"
    assert resolved.config.name == "Database Clinic"
    assert resolved.tenant == "workspace-two"
    assert settings.tenant == "deployment"
    assert calls == [("postgres://db", DEFAULT, "workspace-two")]


@pytest.mark.parametrize(
    "error", [AgentNotFoundError("missing"), ConnectionRefusedError(), TimeoutError()]
)
def test_explicit_dispatch_never_falls_back_to_yaml(monkeypatch, error):
    _fake_database(monkeypatch, error)
    with pytest.raises(type(error)):
        asyncio.run(
            resolve_agent(
                json.dumps({"agent": DEFAULT, "tenant": "unknown"}),
                _settings(database_url="postgres://db"),
            )
        )


def test_explicit_dispatch_requires_database(monkeypatch):
    calls = _fake_database(monkeypatch, AssertionError("should not be called"))
    with pytest.raises(AgentConfigNotFoundError, match="requires a database"):
        asyncio.run(resolve_agent(json.dumps({"agent": DEFAULT, "tenant": "default"}), _settings()))
    assert calls == []


@pytest.mark.parametrize("error", [AgentNotFoundError("missing"), ConnectionRefusedError()])
def test_standalone_database_failure_can_use_yaml(monkeypatch, error):
    _fake_database(monkeypatch, error)
    resolved = asyncio.run(
        resolve_agent(None, _settings(database_url="postgres://db", tenant="standalone"))
    )
    assert resolved.source == "yaml"
    assert resolved.tenant == "standalone"
    assert resolved.config.name == "Bright Smile Dental"


def test_archived_database_agent_does_not_fall_back_to_yaml(monkeypatch):
    _fake_database(monkeypatch, AgentArchivedError("archived"))
    settings = _settings(database_url="postgres://db")
    with pytest.raises(AgentArchivedError, match="archived"):
        asyncio.run(resolve_agent(None, settings))


def test_no_database_uses_yaml(monkeypatch):
    calls = _fake_database(monkeypatch, AssertionError("should not be called"))
    resolved = asyncio.run(resolve_agent(None, _settings()))
    assert resolved.source == "yaml"
    assert calls == []


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
        hit = await resolve_agent(json.dumps({"agent": slug, "tenant": "default"}), settings)
        assert hit.source == "database"
        assert hit.config.name == "Database Clinic"
        miss = await resolve_agent(None, settings)
        assert miss.config.name == "Bright Smile Dental"
        assert miss.slug == DEFAULT
    finally:
        await conn.execute("delete from agents where slug = $1", slug)
        await conn.close()


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_resolve_against_postgres():
    asyncio.run(_database_roundtrip())


async def _tenant_roundtrip() -> None:
    tenant = f"test-{uuid.uuid4().hex[:12]}"
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        tenant_id = await conn.fetchval(
            "insert into tenants (slug, name) values ($1, $1) returning id", tenant
        )
        await conn.execute(
            "insert into agents (tenant_id, slug, name, config) values ($1, $2, $3, $4)",
            tenant_id,
            DEFAULT,
            CONFIG["name"],
            json.dumps(CONFIG),
        )
        own = await resolve_agent(None, _settings(database_url=DATABASE_URL, tenant=tenant))
        assert own.source == "database"
        assert own.config.name == "Database Clinic"
    finally:
        await conn.execute("delete from tenants where slug = $1", tenant)
        await conn.close()


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_resolve_reads_the_configured_tenant():
    asyncio.run(_tenant_roundtrip())


async def _dispatched_workspaces_roundtrip():
    conn = await asyncpg.connect(DATABASE_URL)
    tenants = [f"scope-{uuid.uuid4().hex[:12]}" for _ in range(2)]
    settings = _settings(database_url=DATABASE_URL, tenant="deployment")
    try:
        for index, tenant in enumerate(tenants):
            tenant_id = await conn.fetchval(
                "insert into tenants (slug, name) values ($1, $1) returning id", tenant
            )
            config = {**CONFIG, "name": f"Workspace {index}"}
            await conn.execute(
                "insert into agents (tenant_id, slug, name, config) values ($1, $2, $3, $4)",
                tenant_id,
                DEFAULT,
                config["name"],
                json.dumps(config),
            )
        resolved = await asyncio.gather(
            *[
                resolve_agent(json.dumps({"agent": DEFAULT, "tenant": tenant}), settings)
                for tenant in tenants
            ]
        )
        assert [agent.config.name for agent in resolved] == ["Workspace 0", "Workspace 1"]
        assert [agent.tenant for agent in resolved] == tenants
        assert settings.tenant == "deployment"
        with pytest.raises(AgentNotFoundError):
            await resolve_agent(
                json.dumps({"agent": DEFAULT, "tenant": "nonexistent-workspace"}), settings
            )
    finally:
        await conn.execute("delete from tenants where slug = any($1::text[])", tenants)
        await conn.close()


@pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")
def test_explicit_dispatch_separates_same_slug_across_workspaces():
    asyncio.run(_dispatched_workspaces_roundtrip())
