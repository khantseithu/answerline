import { env } from "@/env";
import { createCallTokenHandler } from "@/lib/call-token-handler";
import { getDashboardContext } from "@/lib/dashboard/context";

export const POST = createCallTokenHandler(getDashboardContext, {
  agentName: env.AGENT_NAME,
  apiKey: env.LIVEKIT_API_KEY,
  apiSecret: env.LIVEKIT_API_SECRET,
  serverUrl: env.LIVEKIT_URL,
});
