import { connection } from "next/server";
import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import { parseCallsQuery } from "@/lib/calls/query";
import { listCalls } from "@/lib/calls/service";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  await connection();
  const parsed = parseCallsQuery(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query", issues: parsed.error.issues },
      { headers: noStore, status: 400 }
    );
  }
  try {
    const { db, tenantId } = await getWorkspaceApiContext("calls:read", "read");
    return Response.json(await listCalls(db, tenantId, parsed.data), { headers: noStore });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}
