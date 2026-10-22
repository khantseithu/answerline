import json
from pathlib import Path

import jsonschema
import pydantic
import pytest
import yaml
from answerline_agent.config import AgentConfig

SHARED = Path(__file__).resolve().parents[3] / "packages/shared"
FIXTURES = SHARED / "fixtures/agent-config"
JSON_SCHEMA = json.loads((SHARED / "schema/agent-config.schema.json").read_text())


def fixtures(kind: str) -> list[Path]:
    return sorted((FIXTURES / kind).glob("*.yaml"))


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
    data = yaml.safe_load(path.read_text())
    jsonschema.validate(data, JSON_SCHEMA)
    AgentConfig.model_validate(data)


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda p: p.stem)
def test_invalid_fixture(path: Path):
    data = yaml.safe_load(path.read_text())
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(data, JSON_SCHEMA)
    with pytest.raises(pydantic.ValidationError):
        AgentConfig.model_validate(data)


def test_pydantic_fields_match_zod_schema():
    assert property_paths(AgentConfig.model_json_schema()) == property_paths(JSON_SCHEMA)
