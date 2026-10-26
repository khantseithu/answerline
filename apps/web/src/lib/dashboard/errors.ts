export class DashboardAuthError extends Error {}
export class DashboardForbiddenError extends Error {}
export class WorkspaceRequiredError extends Error {}

export function dashboardErrorResponse(error: unknown) {
  if (error instanceof DashboardAuthError) {
    return Response.json(
      { error: "Sign in to continue" },
      { headers: { "Cache-Control": "no-store" }, status: 401 }
    );
  }
  if (error instanceof DashboardForbiddenError || error instanceof WorkspaceRequiredError) {
    return Response.json(
      { error: error.message },
      { headers: { "Cache-Control": "no-store" }, status: 403 }
    );
  }
  console.error(error);
  return Response.json(
    { error: "Internal server error" },
    { headers: { "Cache-Control": "no-store" }, status: 500 }
  );
}
