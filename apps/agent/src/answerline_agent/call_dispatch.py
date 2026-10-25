from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

DispatchSlug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")]


class CallDispatchMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    agent: DispatchSlug
    tenant: DispatchSlug
