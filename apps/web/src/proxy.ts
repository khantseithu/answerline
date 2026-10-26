import { NextResponse } from "next/server";
import { env } from "@/env";
import { appendAuthCookies, guardApiRequest } from "@/lib/auth/access";
import { getAuth } from "@/lib/auth/server";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

export async function proxy(request: Request) {
  try {
    const session = request.headers.get("cookie")
      ? await getAuth().api.getSession({ headers: request.headers, returnHeaders: true })
      : undefined;
    const { pathname } = new URL(request.url);
    const isApiRequest = pathname.startsWith("/api/v1/");
    let denied: Response | undefined;
    if (isApiRequest) {
      denied = await guardApiRequest(
        request,
        async () => session?.response,
        new URL(env.BETTER_AUTH_URL).origin
      );
    } else if (!session?.response) {
      denied = NextResponse.redirect(new URL("/login", request.url));
    }
    const response = denied ?? NextResponse.next();
    appendAuthCookies(session?.headers, response.headers);
    return response;
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}

export const config = {
  matcher: [
    "/api/v1/:path*",
    "/overview/:path*",
    "/calls/:path*",
    "/agents/:path*",
    "/evals/:path*",
    "/knowledge/:path*",
    "/phone-numbers/:path*",
    "/settings/:path*",
    "/workspaces/:path*",
  ],
};
