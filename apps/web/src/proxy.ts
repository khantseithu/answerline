import { NextResponse } from "next/server";
import { env } from "@/env";
import { guardApiRequest } from "@/lib/auth/access";
import { getAuth } from "@/lib/auth/server";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

export async function proxy(request: Request) {
  try {
    const denied = await guardApiRequest(
      request,
      (headers) => getAuth().api.getSession({ headers }),
      new URL(env.BETTER_AUTH_URL).origin
    );
    return denied ?? NextResponse.next();
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}

export const config = { matcher: "/api/v1/:path*" };
