import asyncio
from collections.abc import AsyncIterable

from livekit import rtc
from livekit.agents import Agent, ModelSettings
from livekit.agents.telemetry import set_tracer_provider, tracer
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .settings import Settings


def configure_tracing(
    settings: Settings, room_name: str, agent_slug: str, tenant_slug: str
) -> TracerProvider | None:
    endpoint = settings.otel_exporter_otlp_traces_endpoint
    if endpoint is None and settings.otel_exporter_otlp_endpoint is not None:
        endpoint = f"{str(settings.otel_exporter_otlp_endpoint).rstrip('/')}/v1/traces"
    if endpoint is None:
        return None
    provider = TracerProvider(
        resource=Resource.create({"service.name": settings.otel_service_name})
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=str(endpoint), timeout=settings.otel_exporter_otlp_timeout)
        )
    )
    set_tracer_provider(
        provider,
        allow_pii=False,
        metadata={
            "answerline.room": room_name,
            "answerline.tenant": tenant_slug,
            "answerline.agent": agent_slug,
        },
    )
    return provider


async def flush_tracing(provider: TracerProvider) -> None:
    def flush_and_shutdown() -> None:
        provider.force_flush(timeout_millis=5000)
        provider.shutdown()

    await asyncio.to_thread(flush_and_shutdown)


class TracedAgent(Agent):
    async def stt_node(self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings):
        with tracer.start_as_current_span("stt_node"):
            async for event in Agent.default.stt_node(self, audio, model_settings):
                yield event
