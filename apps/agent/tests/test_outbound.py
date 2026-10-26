from types import SimpleNamespace

from answerline_agent.outbound import (
    is_outbound_room,
    outbound_amd_requested,
    outbound_participant_identity,
)


def test_outbound_participant_identity_matches_room_call_id():
    assert outbound_participant_identity("call-123") == "callee-123"


def test_outbound_room_requires_answerline_direction_marker():
    assert is_outbound_room(SimpleNamespace(metadata='{"answerline":{"direction":"outbound"}}'))
    assert not is_outbound_room(SimpleNamespace(metadata=""))
    assert not is_outbound_room(SimpleNamespace(metadata='{"answerline":{"direction":"inbound"}}'))


def test_outbound_amd_is_enabled_by_room_metadata():
    assert outbound_amd_requested(
        SimpleNamespace(
            metadata='{"answerline":{"direction":"outbound","answering_machine_detection":true}}'
        )
    )
    assert not outbound_amd_requested(
        SimpleNamespace(metadata='{"answerline":{"direction":"outbound"}}')
    )
