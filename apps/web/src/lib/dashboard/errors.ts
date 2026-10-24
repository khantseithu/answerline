export class DashboardAuthError extends Error {}

export function dashboardErrorResponse(error: unknown) {
  if (error instanceof DashboardAuthError) {
    return Response.json(
      { error: "Sign in to continue" },
      { headers: { "Cache-Control": "no-store" }, status: 401 }
    );
  }
  console.error(error);
  return Response.json(
    { error: "Internal server error" },
    { headers: { "Cache-Control": "no-store" }, status: 500 }
  );
}
