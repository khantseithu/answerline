"use client";

import { useSession } from "@livekit/components-react";
import { TokenSource } from "livekit-client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo } from "react";
import { AgentSessionProvider } from "@/components/agents-ui/agent-session-provider";
import { AgentSessionView_01 } from "@/components/agents-ui/blocks/agent-session-view-01";
import { StartAudioButton } from "@/components/agents-ui/start-audio-button";
import { Button } from "@/components/ui/button";

const CONTROLS = { camera: false, chat: true, leave: true, microphone: true, screenShare: false };

const FADE = {
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  initial: { opacity: 0 },
  transition: { duration: 0.3 },
};

export function CallApp({ agentName, agentSlug }: { agentName: string; agentSlug: string }) {
  const tokenSource = useMemo(
    () => TokenSource.endpoint(`/api/v1/token?agent=${encodeURIComponent(agentSlug)}`),
    [agentSlug]
  );
  const session = useSession(tokenSource);
  const startCall = useCallback(() => session.start(), [session]);
  const endCall = useCallback(() => session.end(), [session]);

  return (
    <AgentSessionProvider session={session}>
      <AnimatePresence mode="wait">
        {session.isConnected ? (
          <motion.div className="fixed inset-0" key="session" {...FADE}>
            <AgentSessionView_01
              className="h-full"
              controls={CONTROLS}
              isPreConnectBufferEnabled
              onDisconnect={endCall}
              preConnectMessage="Connecting you to the receptionist…"
            />
          </motion.div>
        ) : (
          <motion.section
            className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center"
            key="welcome"
            {...FADE}
          >
            <div className="flex flex-col gap-2">
              <h1 className="font-semibold text-3xl tracking-tight">{agentName}</h1>
              <p className="text-muted-foreground">
                Talk to the AI receptionist from your browser.
              </p>
            </div>
            <Button className="w-56 rounded-full" onClick={startCall} size="lg">
              Talk to agent
            </Button>
          </motion.section>
        )}
      </AnimatePresence>
      <StartAudioButton label="Start audio" />
    </AgentSessionProvider>
  );
}
