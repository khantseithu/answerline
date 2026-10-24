import { NextResponse } from "next/server";
import { env } from "@/env";
import { appendAuthCookies, guardApiRequest } from "@/lib/auth/access";
import { getAuth } from "@/lib/auth/server";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

export async function proxy(request: Request) {
  try {
    let authResponseHeaders: Headers | undefined;
    const denied = await guardApiRequest(
      request,
      async (headers) => {
        const session = await getAuth().api.getSession({ headers, returnHeaders: true });
        authResponseHeaders = session.headers;
        return session.response;
      },
      new URL(env.BETTER_AUTH_URL).origin
    );
    const response = denied ?? NextResponse.next();
    appendAuthCookies(authResponseHeaders, response.headers);
    return response;
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}

export const config = { matcher: "/api/v1/:path*" };
