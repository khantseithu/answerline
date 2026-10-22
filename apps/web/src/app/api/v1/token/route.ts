import { env } from "@/env";
import { AGENT_SLUG_PATTERN, createCallToken, DEFAULT_AGENT_SLUG } from "@/lib/call-token";

export async function POST(request: Request) {
  if (env.NODE_ENV === "production") {
    return Response.json(
      { error: "Anonymous calls are disabled until authentication lands" },
      { status: 403 }
    );
  }

  const agentSlug = new URL(request.url).searchParams.get("agent") ?? DEFAULT_AGENT_SLUG;
  if (!AGENT_SLUG_PATTERN.test(agentSlug)) {
    return Response.json({ error: "Invalid agent" }, { status: 400 });
  }

  const details = await createCallToken({
    agentSlug,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    serverUrl: env.LIVEKIT_URL,
  });

  return Response.json(details, { headers: { "Cache-Control": "no-store" } });
}
