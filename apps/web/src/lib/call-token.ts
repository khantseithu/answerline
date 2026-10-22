import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

export const AGENT_NAME = "answerline";
export const DEFAULT_AGENT_SLUG = "bright-smile-dental";
export const AGENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface CallConnectionDetails {
  participantName: string;
  participantToken: string;
  roomName: string;
  serverUrl: string;
}

export async function createCallToken(options: {
  agentSlug: string;
  apiKey: string;
  apiSecret: string;
  serverUrl: string;
}): Promise<CallConnectionDetails> {
  const callId = crypto.randomUUID();
  const roomName = `call-${callId}`;
  const participantName = "Caller";

  const token = new AccessToken(options.apiKey, options.apiSecret, {
    identity: `caller-${callId}`,
    name: participantName,
    ttl: "15m",
  });
  token.addGrant({
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    room: roomName,
    roomJoin: true,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: AGENT_NAME,
        metadata: JSON.stringify({ agent: options.agentSlug }),
      }),
    ],
  });

  return {
    participantName,
    participantToken: await token.toJwt(),
    roomName,
    serverUrl: options.serverUrl,
  };
}
