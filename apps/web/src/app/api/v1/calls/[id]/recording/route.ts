import { env } from "@/env";
import { createRecordingStorage, getCallRecordingUrl } from "@/lib/calls/recording";
import { getDashboardContext } from "@/lib/dashboard/context";
import { dashboardErrorResponse } from "@/lib/dashboard/errors";

const storage = createRecordingStorage({
  accessKeyId: env.S3_ACCESS_KEY,
  bucket: env.S3_BUCKET,
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  secretAccessKey: env.S3_SECRET_KEY,
});

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/calls/[id]/recording">) {
  const { id } = await ctx.params;
  try {
    const { db, tenantId } = await getDashboardContext();
    const url = await getCallRecordingUrl(db, tenantId, id, storage);
    if (!url) {
      return Response.json(
        { error: "Recording not found" },
        { headers: { "Cache-Control": "no-store" }, status: 404 }
      );
    }
    return new Response(null, {
      headers: { "Cache-Control": "no-store", Location: url },
      status: 302,
    });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}
