export async function workspaceRequest(path: string, method = "POST", input?: unknown) {
  const response = await fetch(path, {
    body: input === undefined ? undefined : JSON.stringify(input),
    cache: "no-store",
    headers: input === undefined ? undefined : { "Content-Type": "application/json" },
    method,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Unable to update workspace. Try again."
    );
  }
  return response;
}
