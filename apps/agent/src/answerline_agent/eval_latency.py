from collections.abc import Iterable

from .call_events import turn_latency


def agent_turn_stages(
    message_metrics: Iterable[dict], llm_durations_s: Iterable[float]
) -> dict[str, int]:
    stages: dict[str, int] = {}
    for metrics in message_metrics:
        latency = turn_latency(metrics)
        if latency is None:
            continue
        if latency.llm_ttft_ms is not None:
            stages.setdefault("llmTtftMs", round(latency.llm_ttft_ms))
        if latency.tts_ttfb_ms is not None:
            stages.setdefault("ttsTtfbMs", round(latency.tts_ttfb_ms))
    durations = list(llm_durations_s)
    if durations:
        stages["llmTotalMs"] = max(round(sum(durations) * 1000), 0)
    return stages
