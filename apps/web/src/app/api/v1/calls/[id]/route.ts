import { connection } from "next/server";
import { getWorkspaceApiContext } from "@/lib/api-keys/context";
import { getCallDetail } from "@/lib/calls/detail";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: RouteContext<"/api/v1/calls/[id]">) {
  await connection();
  const { id } = await params;
  try {
    const { db, tenantId } = await getWorkspaceApiContext("calls:read", "read");
    const call = await getCallDetail(db, tenantId, id);
    if (!call) {
      return Response.json({ error: "Call not found" }, { headers: noStore, status: 404 });
    }
    return Response.json(call, { headers: noStore });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}
