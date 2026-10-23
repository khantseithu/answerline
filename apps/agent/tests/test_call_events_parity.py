import json
from pathlib import Path

import jsonschema
import pytest
from answerline_agent.call_events import CALL_EVENTS_QUEUE, CallEvent, call_event_job_id
from pydantic import TypeAdapter, ValidationError

SHARED = Path(__file__).resolve().parents[3] / "packages/shared"
FIXTURES = SHARED / "fixtures/call-event"
JSON_SCHEMA = json.loads((SHARED / "schema/call-event.schema.json").read_text())
ADAPTER = TypeAdapter(CallEvent)


def fixtures(kind: str) -> list[Path]:
    return sorted((FIXTURES / kind).glob("*.json"))


def property_paths(schema: dict, node: dict | None = None, prefix: str = "") -> set[str]:
    node = schema if node is None else node
    if "$ref" in node:
        return property_paths(schema, schema["$defs"][node["$ref"].split("/")[-1]], prefix)
    paths: set[str] = set()
    for key in ("anyOf", "oneOf", "allOf"):
        for option in node.get(key, []):
            paths |= property_paths(schema, option, prefix)
    if "items" in node:
        paths |= property_paths(schema, node["items"], f"{prefix}[]")
    for name, child in node.get("properties", {}).items():
        path = f"{prefix}.{name}" if prefix else name
        paths |= {path} | property_paths(schema, child, path)
    return paths


@pytest.mark.parametrize("path", fixtures("valid"), ids=lambda p: p.stem)
def test_valid_fixture(path: Path):
    data = json.loads(path.read_text())
    jsonschema.validate(data, JSON_SCHEMA)
    event = ADAPTER.validate_python(data)
    assert event.type == data["type"]


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda p: p.stem)
def test_invalid_fixture(path: Path):
    data = json.loads(path.read_text())
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(data, JSON_SCHEMA)
    with pytest.raises(ValidationError):
        ADAPTER.validate_python(data)


def test_pydantic_fields_match_json_schema():
    assert property_paths(ADAPTER.json_schema()) == property_paths(JSON_SCHEMA)


@pytest.mark.parametrize("value", ["2026-10-22T14:00:00", "2026-10-22", "2026-13-40T00:00:00Z"])
def test_timestamps_require_offset_and_valid_date(value: str):
    data = json.loads((FIXTURES / "valid/ended.json").read_text())
    data["ended_at"] = value
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(data, JSON_SCHEMA)
    with pytest.raises(ValidationError):
        ADAPTER.validate_python(data)


def test_job_ids_follow_shared_format():
    ids = {
        path.stem: call_event_job_id(ADAPTER.validate_python(json.loads(path.read_text())))
        for path in fixtures("valid")
    }
    room = "call-0b9c1c3e-2f4a-4e8e-9d3a-5f1f2b7c9a10"
    assert ids["ended"] == f"{room}_call.ended"
    assert ids["started-web"] == f"{room}_call.started"
    assert ids["turn-caller"] == f"{room}_call.turn_1"
    assert ids["tool-ok"] == f"{room}_call.tool_0"
    assert ids["tool-ok"] == f"{room}_call.tool_0"


def test_queue_name_matches_shared_constant():
    events_ts = (SHARED / "src/events.ts").read_text()
    assert f'callEvents: "{CALL_EVENTS_QUEUE}"' in events_ts
