import logging

from livekit.agents import llm

from .business_hours import build_business_hours_tool
from .config import AgentConfig, BuiltinTool
from .settings import Settings

logger = logging.getLogger("answerline.agent")


def build_configured_tools(
    config: AgentConfig, settings: Settings | None = None
) -> list[llm.FunctionTool]:
    tools: list[llm.FunctionTool] = []
    for spec in config.tools:
        if isinstance(spec, BuiltinTool) and spec.builtin == "business_hours":
            if any(tool.id == spec.builtin for tool in tools):
                continue
            if config.hours is None:
                raise ValueError("business_hours requires an hours configuration")
            tools.append(build_business_hours_tool(config.hours, settings))
        else:
            name = spec.builtin if isinstance(spec, BuiltinTool) else type(spec).__name__
            logger.warning("Configured tool %s is not implemented and will not be available", name)
    return tools
