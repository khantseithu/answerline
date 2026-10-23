from typing import Any


class ToolLog:
    def __init__(self) -> None:
        self._entries: dict[str, Any] = {}

    def attach(self, call_id: str, result: Any) -> None:
        self._entries[call_id] = result

    def take(self, call_id: str) -> Any:
        return self._entries.pop(call_id, None)
