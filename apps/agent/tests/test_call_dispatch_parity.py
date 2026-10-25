import json
from pathlib import Path

import jsonschema
import pytest
from answerline_agent.call_dispatch import CallDispatchMetadata
from pydantic import ValidationError

SHARED = Path(__file__).resolve().parents[3] / "packages/shared"
FIXTURES = SHARED / "fixtures/call-dispatch"
JSON_SCHEMA = json.loads((SHARED / "schema/call-dispatch.schema.json").read_text())


@pytest.mark.parametrize("path", sorted((FIXTURES / "valid").glob("*.json")), ids=lambda p: p.stem)
def test_valid_dispatch_fixture(path: Path):
    data = json.loads(path.read_text())
    jsonschema.validate(data, JSON_SCHEMA)
    assert CallDispatchMetadata.model_validate(data).model_dump() == data
    assert CallDispatchMetadata.model_validate_json(path.read_text()).model_dump() == data


@pytest.mark.parametrize(
    "path", sorted((FIXTURES / "invalid").glob("*.json")), ids=lambda p: p.stem
)
def test_invalid_dispatch_fixture(path: Path):
    data = json.loads(path.read_text())
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(data, JSON_SCHEMA)
    with pytest.raises(ValidationError):
        CallDispatchMetadata.model_validate(data)
    with pytest.raises(ValidationError):
        CallDispatchMetadata.model_validate_json(path.read_text())
