import { DashboardAuthError, dashboardErrorResponse } from "@/lib/dashboard/errors";

export function readOptionalSession<T>(
  headers: Headers,
  lookup: (headers: Headers) => Promise<T>
): Promise<T | null> {
  if (!headers.get("cookie")) {
    return Promise.resolve(null);
  }
  return lookup(headers);
}

export function appendAuthCookies(source: Headers | undefined, target: Headers) {
  for (const cookie of source?.getSetCookie() ?? []) {
    target.append("set-cookie", cookie);
  }
}

export async function guardApiRequest(
  request: Request,
  resolveSession: (headers: Headers) => Promise<unknown>,
  trustedOrigin: string
) {
  if (!(request.headers.get("cookie") && (await resolveSession(request.headers)))) {
    return dashboardErrorResponse(new DashboardAuthError());
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== trustedOrigin)
    ) {
      return Response.json(
        { error: "Cross-origin requests are not allowed" },
        { headers: { "Cache-Control": "no-store" }, status: 403 }
      );
    }
  }
}
