from pathlib import Path

import pytest
from answerline_agent.config import (
    BookAppointmentTool,
    BuiltinTool,
    Hours,
    HttpTool,
    McpTool,
    load_agent_config,
)
from answerline_agent.tools import build_configured_tools
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
    agent.tools.extend(
        [BuiltinTool(builtin="business_hours"), BuiltinTool(builtin="business_hours")]
    )
    tools = build_configured_tools(agent)
    assert [tool.id for tool in tools] == ["business_hours"]
    assert Agent(instructions="Be brief.", tools=tools).tools == tools
    assert "book_appointment provider 'answerline' is not available" in caplog.text
    assert "transfer_call is not implemented" in caplog.text
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


@pytest.mark.parametrize("has_knowledge", [False, True])
def test_entrypoint_registers_configured_tools_alongside_knowledge(monkeypatch, has_knowledge):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from answerline_agent import main
    from livekit.agents import llm

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
        AsyncMock(return_value=SimpleNamespace(config=agent_config, slug="a")),
    )
    monkeypatch.setattr(main, "open_knowledge_tools", AsyncMock(return_value=knowledge))
    monkeypatch.setattr(main, "open_booking_provider", AsyncMock(return_value=None))
    session = SimpleNamespace(start=AsyncMock(side_effect=RuntimeError("registration captured")))
    monkeypatch.setattr(main, "AgentSession", lambda **kwargs: session)
    for name in ("build_stt", "build_llm_chain", "build_tts", "build_turn_handling"):
        monkeypatch.setattr(main, name, lambda value: None)
    monkeypatch.setattr(main, "build_call_recording", lambda *args: None)
    monkeypatch.setattr(main, "CallEventPublisher", lambda *args: None)
    monkeypatch.setattr(main, "CallSessionEvents", lambda **kwargs: None)
    ctx = SimpleNamespace(
        room=SimpleNamespace(name="room"),
        job=SimpleNamespace(metadata=""),
        proc=SimpleNamespace(userdata={"vad": None}),
        add_shutdown_callback=lambda callback: None,
    )
    with pytest.raises(RuntimeError, match="registration captured"):
        asyncio.run(main.entrypoint(ctx))
    registered = session.start.call_args.kwargs["agent"].tools
    assert [tool.id for tool in registered] == (
        ["search_knowledge", "business_hours", "capture_lead"]
        if has_knowledge
        else ["business_hours", "capture_lead"]
    )
    if has_knowledge:
        assert registered[0] is knowledge_tool


def test_capture_lead_requires_per_call_context():
    agent = config()
    agent.tools = [BuiltinTool(builtin="capture_lead")]
    with pytest.raises(ValueError, match="requires a per-call lead context"):
        build_configured_tools(agent)


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
        "cancel_appointment",
    ]


def test_book_appointment_requires_hours():
    agent = config()
    agent.tools = [BookAppointmentTool(builtin="book_appointment")]
    agent.hours = None
    with pytest.raises(ValueError, match="book_appointment requires an hours configuration"):
        build_configured_tools(agent, booking=object())
