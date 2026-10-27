from answerline_agent.eval_latency import agent_turn_stages


def test_reads_llm_ttft_and_tts_ttfb_from_message_metrics_in_milliseconds():
    stages = agent_turn_stages([{"llm_node_ttft": 0.42, "tts_node_ttfb": 0.15}], [])
    assert stages == {"llmTtftMs": 420, "ttsTtfbMs": 150}


def test_ignores_user_only_metrics_so_stt_is_measured_by_the_runner():
    assert agent_turn_stages([{"transcription_delay": 0.3}], []) == {}


def test_uses_the_first_message_that_has_each_stage():
    stages = agent_turn_stages(
        [{"llm_node_ttft": 0.2}, {"llm_node_ttft": 0.9, "tts_node_ttfb": 0.1}], []
    )
    assert stages == {"llmTtftMs": 200, "ttsTtfbMs": 100}


def test_sums_llm_request_durations_for_tool_round_trips():
    assert agent_turn_stages([], [0.25, 0.5]) == {"llmTotalMs": 750}


def test_returns_nothing_without_samples():
    assert agent_turn_stages([], []) == {}
    assert agent_turn_stages([{}, {"started_speaking_at": 1.0}], []) == {}
