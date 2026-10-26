import { openApiSpec } from "@/lib/openapi/spec";

export function GET() {
  return Response.json(openApiSpec, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.oai.openapi+json;version=3.1.0",
    },
  });
}
