from pathlib import Path
from types import SimpleNamespace

import pytest
from answerline_agent.capture_lead import LeadCaptureContext
from answerline_agent.config import (
    BookAppointmentTool,
    BuiltinTool,
    Hours,
    HttpTool,
    McpTool,
    TransferCallTool,
    load_agent_config,
)
from answerline_agent.tools import build_configured_tools
from answerline_agent.transfer import CallTransfer
from livekit.agents import Agent

ROOT = Path(__file__).resolve().parents[3]


def config():
    return load_agent_config(ROOT / "agents/bright-smile-dental.yaml")


def test_hours_without_explicit_tool_does_not_enable_tool():
    agent = config()
    agent.tools = []
    assert build_configured_tools(agent) == []


def test_only_configured_supported_tools_are_registered_once(caplog):
    agent = config()
    agent.tools = [
        BookAppointmentTool(builtin="book_appointment"),
        TransferCallTool(builtin="transfer_call", to="+15555550100"),
        HttpTool(
            http={
                "name": "lookup",
                "description": "Lookup",
                "method": "GET",
                "url": "https://x.test",
            }
        ),
        BuiltinTool(builtin="business_hours"),
        BuiltinTool(builtin="business_hours"),
    ]
    tools = build_configured_tools(agent)
    assert [tool.id for tool in tools] == ["business_hours"]
    assert Agent(instructions="Be brief.", tools=tools).tools == tools
    assert "book_appointment provider 'answerline' is not available" in caplog.text
    assert "transfer_call has no transfer target available" in caplog.text
    assert "HttpTool is not implemented" in caplog.text


def test_unimplemented_config_does_not_register_dead_tools(caplog):
    agent = config()
    agent.tools = [
        BookAppointmentTool(builtin="book_appointment"),
        HttpTool(
            http={
                "name": "lookup",
                "description": "Lookup",
                "method": "GET",
                "url": "https://x.test",
            }
        ),
        McpTool(mcp={"name": "crm", "url": "https://x.test"}),
    ]
    assert build_configured_tools(agent) == []
    assert "book_appointment provider 'answerline' is not available" in caplog.text
    assert "McpTool is not implemented" in caplog.text


def test_business_hours_requires_hours():
    agent = config()
    agent.tools = [BuiltinTool(builtin="business_hours")]
    agent.hours = None
    with pytest.raises(ValueError, match="requires an hours configuration"):
        build_configured_tools(agent)


def test_configured_tools_are_isolated_per_agent():
    first, second = config(), config()
    first.tools = second.tools = [BuiltinTool(builtin="business_hours")]
    second.hours = Hours(timezone="Asia/Bangkok", weekdays="08:00-17:00")
    first_tools, second_tools = build_configured_tools(first), build_configured_tools(second)
    assert first_tools[0] is not second_tools[0]


@pytest.mark.parametrize(
    ("has_knowledge", "closed"), [(False, False), (True, False), (False, True)]
)
def test_entrypoint_registers_configured_tools_alongside_knowledge(
    monkeypatch, has_knowledge, closed
):
    import asyncio
    from datetime import datetime
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from answerline_agent import business_hours, main
    from livekit.agents import llm

    now = datetime.fromisoformat(
        "2026-10-24T15:00:00+00:00" if closed else "2026-10-23T15:00:00+00:00"
    )
    monkeypatch.setattr(
        business_hours, "datetime", SimpleNamespace(now=lambda zone: now.astimezone(zone))
    )

    async def search_knowledge(query: str) -> str:
        return query

    agent_config = config()
    agent_config.tools = [
        BuiltinTool(builtin="business_hours"),
        BuiltinTool(builtin="capture_lead"),
    ]
    knowledge_tool = llm.function_tool(search_knowledge, description="Search knowledge")
    knowledge = (
        SimpleNamespace(tools=[knowledge_tool], close=AsyncMock()) if has_knowledge else None
    )
    monkeypatch.setattr(
        main,
        "resolve_agent",
        AsyncMock(
            return_value=SimpleNamespace(config=agent_config, slug="a", tenant="workspace-two")
        ),
    )
    monkeypatch.setattr(main, "open_knowledge_tools", AsyncMock(return_value=knowledge))
    monkeypatch.setattr(main, "open_booking_provider", AsyncMock(return_value=None))
    session = SimpleNamespace(start=AsyncMock(side_effect=RuntimeError("registration captured")))
    monkeypatch.setattr(main, "AgentSession", lambda **kwargs: session)
    for name in ("build_stt", "build_llm_chain", "build_tts", "build_turn_handling"):
        monkeypatch.setattr(main, name, lambda *_args, **_kwargs: None)
    recorded = []
    event_context = {}
    tool_context = {}
    configure_tools = main.build_configured_tools

    def capture_tools(*args, **kwargs):
        tool_context.update(kwargs)
        return configure_tools(*args, **kwargs)

    monkeypatch.setattr(main, "build_configured_tools", capture_tools)
    monkeypatch.setattr(main, "build_call_recording", lambda *args: recorded.append(args))
    monkeypatch.setattr(main, "CallEventPublisher", lambda *args: None)
    monkeypatch.setattr(main, "CallSessionEvents", lambda **kwargs: event_context.update(kwargs))
    ctx = SimpleNamespace(
        room=SimpleNamespace(name="room"),
        job=SimpleNamespace(metadata=""),
        proc=SimpleNamespace(userdata={"vad": None}),
        add_shutdown_callback=lambda callback: None,
    )
    with pytest.raises(RuntimeError, match="registration captured"):
        asyncio.run(main.entrypoint(ctx))
    assert event_context["tenant"] == "workspace-two"
    assert tool_context["lead_context"].tenant == "workspace-two"
    assert recorded[0][2] == "workspace-two"
    main.open_booking_provider.assert_awaited_once_with(
        agent_config, main.settings, "a", "room", tenant_slug="workspace-two"
    )
    assert main.open_knowledge_tools.await_args.kwargs["tenant_slug"] == "workspace-two"
    agent = session.start.call_args.kwargs["agent"]
    registered = agent.tools
    assert [tool.id for tool in registered] == [
        *(["search_knowledge"] if has_knowledge else []),
        "business_hours",
        "capture_lead",
        *(["take_voicemail"] if closed else []),
    ]
    assert ("closed right now" in agent.instructions) is closed
    if has_knowledge:
        assert registered[0] is knowledge_tool


def test_capture_lead_requires_per_call_context():
    agent = config()
    agent.tools = [BuiltinTool(builtin="capture_lead")]
    with pytest.raises(ValueError, match="requires a per-call lead context"):
        build_configured_tools(agent)


def test_voicemail_requires_per_call_context():
    agent = config()
    agent.tools = [BuiltinTool(builtin="voicemail")]
    with pytest.raises(ValueError, match="requires a per-call lead context"):
        build_configured_tools(agent)


def test_voicemail_is_registered_once_alongside_capture_lead():
    agent = config()
    agent.tools = [
        BuiltinTool(builtin="voicemail"),
        BuiltinTool(builtin="capture_lead"),
        BuiltinTool(builtin="voicemail"),
    ]
    context = LeadCaptureContext(
        publisher=SimpleNamespace(), tenant="default", agent="a", room_name="room"
    )
    tools = build_configured_tools(agent, lead_context=context)
    assert [tool.id for tool in tools] == ["take_voicemail", "capture_lead"]


def test_after_hours_voicemail_is_added_once_when_not_configured():
    context = LeadCaptureContext(
        publisher=SimpleNamespace(), tenant="default", agent="a", room_name="room"
    )
    agent = config()
    agent.tools = []
    tools = build_configured_tools(agent, lead_context=context, ensure_voicemail=True)
    assert [tool.id for tool in tools] == ["take_voicemail"]
    agent.tools = [BuiltinTool(builtin="voicemail")]
    tools = build_configured_tools(agent, lead_context=context, ensure_voicemail=True)
    assert [tool.id for tool in tools] == ["take_voicemail"]


def test_book_appointment_uses_opened_provider_once():
    agent = config()
    agent.tools = [
        BookAppointmentTool(builtin="book_appointment"),
        BookAppointmentTool(builtin="book_appointment"),
    ]
    tools = build_configured_tools(agent, booking=object())
    assert [tool.id for tool in tools] == [
        "check_availability",
        "book_appointment",
        "confirm_booking",
        "cancel_appointment",
    ]


def test_transfer_call_registers_once_with_transfer():
    agent = config()
    agent.tools = [
        TransferCallTool(builtin="transfer_call", to="+15555550100"),
        TransferCallTool(builtin="transfer_call", to="+15555550101"),
    ]
    tools = build_configured_tools(agent, transfer=CallTransfer(object(), "+15555550100"))
    assert [tool.id for tool in tools] == ["transfer_call"]


def test_transfer_call_is_skipped_without_transfer(caplog):
    agent = config()
    agent.tools = [TransferCallTool(builtin="transfer_call", to="+15555550100")]
    assert build_configured_tools(agent) == []
    assert "transfer_call has no transfer target available" in caplog.text


def test_book_appointment_requires_hours():
    agent = config()
    agent.tools = [BookAppointmentTool(builtin="book_appointment")]
    agent.hours = None
    with pytest.raises(ValueError, match="book_appointment requires an hours configuration"):
        build_configured_tools(agent, booking=object())
