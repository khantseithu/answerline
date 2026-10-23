import logging

from livekit.agents import llm

from .booking import BOOKING_PROVIDERS, build_booking_tools
from .business_hours import build_business_hours_tool
from .capture_lead import LeadCaptureContext, build_capture_lead_tool
from .config import AgentConfig, BookAppointmentTool, BuiltinTool
from .settings import Settings

logger = logging.getLogger("answerline.agent")


def build_configured_tools(
    config: AgentConfig,
    settings: Settings | None = None,
    *,
    lead_context: LeadCaptureContext | None = None,
) -> list[llm.FunctionTool]:
    tools: list[llm.FunctionTool] = []
    for spec in config.tools:
        if isinstance(spec, BuiltinTool) and spec.builtin == "business_hours":
            if any(tool.id == spec.builtin for tool in tools):
                continue
            if config.hours is None:
                raise ValueError("business_hours requires an hours configuration")
            tools.append(build_business_hours_tool(config.hours, settings))
        elif isinstance(spec, BuiltinTool) and spec.builtin == "capture_lead":
            if any(tool.id == spec.builtin for tool in tools):
                continue
            if lead_context is None:
                raise ValueError("capture_lead requires a per-call lead context")
            tools.append(build_capture_lead_tool(lead_context, settings))
        elif isinstance(spec, BookAppointmentTool):
            if any(tool.id == spec.builtin for tool in tools):
                continue
            factory = BOOKING_PROVIDERS.get(spec.provider)
            if factory is None:
                logger.warning(
                    "Configured tool book_appointment provider %r is not implemented "
                    "and will not be available",
                    spec.provider,
                )
                continue
            if config.hours is None:
                raise ValueError("book_appointment requires an hours configuration")
            tools.extend(build_booking_tools(factory(spec), config.hours.timezone, settings))
        else:
            name = spec.builtin if isinstance(spec, BuiltinTool) else type(spec).__name__
            logger.warning("Configured tool %s is not implemented and will not be available", name)
    return tools
