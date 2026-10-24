import asyncio
import json
from typing import Any

import pytest
from answerline_agent import eval_runner
from answerline_agent.config import AgentConfig
from answerline_agent.eval_runner import (
    _evaluate_assertions,
    _judge,
    build_mock_tools,
    run_case,
    run_suite,
)
from livekit.agents import llm
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

CONFIG = {
    "name": "Test Clinic",
    "greeting": "Hello",
    "instructions": "You are a concise receptionist.",
    "models": {
        "stt": "deepgram/nova-3",
        "llm": {"primary": "openai/gpt-4.1-mini"},
        "tts": "cartesia/sonic-3",
    },
    "tools": [{"builtin": "capture_lead"}],
}


class _TextStream(llm.LLMStream):
    async def _run(self) -> None:
        self._event_ch.send_nowait(
            llm.ChatChunk(
                id="test",
                delta=llm.ChoiceDelta(role="assistant", content="Hello there."),
            )
        )


class _TextLLM(llm.LLM):
    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        return _TextStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class _ToolStream(llm.LLMStream):
    def __init__(self, *args, tool_call: bool, **kwargs):
        super().__init__(*args, **kwargs)
        self.tool_call = tool_call

    async def _run(self) -> None:
        if self.tool_call:
            delta = llm.ChoiceDelta(
                role="assistant",
                tool_calls=[
                    llm.FunctionToolCall(
                        call_id="call_1",
                        name="capture_lead",
                        arguments=(
                            '{"name":"Alex","phone":"+12025550147","reason":"Appointment question"}'
                        ),
                    )
                ],
            )
        else:
            delta = llm.ChoiceDelta(role="assistant", content="Your request was saved.")
        self._event_ch.send_nowait(llm.ChatChunk(id="test", delta=delta))


class _ToolLLM(llm.LLM):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        self.calls += 1
        return _ToolStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            tool_call=self.calls == 1,
        )


class _JudgeStream(llm.LLMStream):
    def __init__(self, *args, response: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.response = response

    async def _run(self) -> None:
        self._event_ch.send_nowait(
            llm.ChatChunk(id="judge", delta=llm.ChoiceDelta(content=self.response))
        )


class _JudgeLLM(llm.LLM):
    def __init__(self, response: str):
        super().__init__()
        self.response = response

    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kwargs):
        return _JudgeStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            response=self.response,
        )


def _config() -> AgentConfig:
    return AgentConfig.model_validate(CONFIG)


def test_run_case_reuses_session_for_multiple_caller_turns():
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "greeting", "caller": ["Hi", "Are you open?"], "expect": {}},
            llm_provider=_TextLLM(),
        )
    )
    assert result["passed"] is True
    assert result["transcript"] == [
        {"role": "agent", "text": "Hello"},
        {"role": "caller", "text": "Hi"},
        {"role": "agent", "text": "Hello there."},
        {"role": "caller", "text": "Are you open?"},
        {"role": "agent", "text": "Hello there."},
    ]
    assert result["costUsd"] is None


def test_mock_tool_records_arguments_and_returns_case_result():
    calls: list[dict[str, Any]] = []
    tool = build_mock_tools(_config(), calls=calls, mocks={"capture_lead": {"status": "accepted"}})[
        0
    ]
    result = asyncio.run(
        tool._func(
            context=object(),
            name="Alex",
            phone="+12025550147",
            reason="Appointment question",
        )
    )
    assert result == {"status": "accepted"}
    assert calls == [
        {
            "name": "capture_lead",
            "args": {
                "name": "Alex",
                "phone": "+12025550147",
                "reason": "Appointment question",
            },
        }
    ]


def test_run_case_executes_mock_tool_and_checks_its_arguments():
    result = asyncio.run(
        run_case(
            _config(),
            {
                "name": "captures lead",
                "caller": "Please call Alex back about an appointment.",
                "expect": {
                    "mentions": ["saved"],
                    "tool_called": "capture_lead",
                    "tool_args": {"capture_lead": {"name": "Alex"}},
                },
            },
            llm_provider=_ToolLLM(),
        )
    )
    assert result["passed"] is True
    assert result["transcript"][-1] == {"role": "agent", "text": "Your request was saved."}


def test_assertions_check_mentions_tools_and_arguments():
    case = {
        "expect": {
            "mentions": ["saved"],
            "not_mentions": ["guaranteed"],
            "tool_called": "capture_lead",
            "tool_args": {"capture_lead": {"name": "Alex"}},
        }
    }
    transcript = [{"role": "agent", "text": "Your request was saved."}]
    calls = [{"name": "capture_lead", "args": {"name": "Alex", "phone": "+12025550147"}}]
    assert _evaluate_assertions(case, transcript, calls) == []


def test_assertions_report_all_failures():
    case = {
        "expect": {
            "mentions": ["appointment"],
            "not_mentions": ["saved"],
            "tool_called": "capture_lead",
            "tool_args": {"capture_lead": {"name": "Alex"}},
        }
    }
    failures = _evaluate_assertions(case, [{"role": "agent", "text": "The request was saved."}], [])
    assert len(failures) == 4


def test_judge_rejects_invalid_json():
    passed, reason, usage = asyncio.run(
        _judge(_JudgeLLM("yes"), "openai/gpt-4.1-mini", "Meets the rubric", [], [])
    )
    assert passed is False
    assert reason == "judge returned invalid JSON"
    assert usage == []


def test_judge_accepts_only_valid_structured_result():
    passed, reason, _usage = asyncio.run(
        _judge(
            _JudgeLLM('{"passed": true, "reason": "Evidence meets rubric"}'),
            "openai/gpt-4.1-mini",
            "Meets the rubric",
            [],
            [],
        )
    )
    assert passed is True
    assert reason == "Evidence meets rubric"


def test_shared_execution_fixtures_match_wire_schemas():
    fixtures = (
        ("execution-input.json", "eval-execution-input.schema.json"),
        ("execution-output.json", "eval-execution-output.schema.json"),
    )
    for fixture_name, schema_name in fixtures:
        fixture = eval_runner.REPO_ROOT / "packages/shared/fixtures/eval/valid" / fixture_name
        payload = json.loads(fixture.read_text())
        eval_runner._validate_wire_payload(payload, schema_name)


def test_run_suite_validates_output_and_keeps_mock_tools_off_database(monkeypatch):
    async def forbidden(*_args, **_kwargs):
        raise AssertionError("mock eval touched a live tool provider")

    monkeypatch.setattr(eval_runner, "open_booking_provider", forbidden)
    monkeypatch.setattr(eval_runner, "open_knowledge_tools", forbidden)
    monkeypatch.setattr(eval_runner, "build_llm_chain", lambda _models: _TextLLM())
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused")
    agent = {
        **CONFIG,
        "hours": {"timezone": "UTC", "weekdays": "09:00-18:00"},
        "tools": [{"builtin": "book_appointment"}],
    }
    payload = {
        "agent": agent,
        "suite": [{"name": "greeting", "caller": "Hi", "expect": {}}],
    }
    output = asyncio.run(run_suite(payload))
    assert output["aggregate"]["total"] == 1
    greeting = output["results"][0]["transcript"][0]
    assert greeting["role"] == "agent"
    assert greeting["text"]


def test_live_tools_use_the_supplied_tenant_and_agent_slugs(monkeypatch):
    received = {}

    async def live_tools(_config, settings, *, agent_slug, tenant_slug):
        received.update(
            agent_slug=agent_slug,
            tenant_slug=tenant_slug,
            settings_tenant=settings.tenant,
        )
        return [], []

    monkeypatch.setattr(eval_runner, "_build_live_tools", live_tools)
    result = asyncio.run(
        run_case(
            _config(),
            {"name": "greeting", "caller": "Hi", "expect": {}},
            llm_provider=_TextLLM(),
            live_tools=True,
            context={"agentSlug": "configured-slug", "tenantSlug": "configured-tenant"},
        )
    )
    assert result["passed"] is True
    assert received == {
        "agent_slug": "configured-slug",
        "tenant_slug": "configured-tenant",
        "settings_tenant": "configured-tenant",
    }


def test_live_tools_require_context():
    with pytest.raises(ValueError, match="requires agentSlug and tenantSlug context"):
        asyncio.run(
            run_case(
                _config(),
                {"name": "greeting", "caller": "Hi", "expect": {}},
                llm_provider=_TextLLM(),
                live_tools=True,
            )
        )
