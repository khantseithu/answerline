"use client";

import { type AgentState, useAgent, useSession } from "@livekit/components-react";
import { ConnectionState, TokenSource } from "livekit-client";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { AgentSessionProvider } from "@/components/agents-ui/agent-session-provider";
import { AgentSessionView_01 } from "@/components/agents-ui/blocks/agent-session-view-01";
import { StartAudioButton } from "@/components/agents-ui/start-audio-button";
import { LogoMark } from "@/components/brand/logo";
import { LiveDot } from "@/components/call/live-dot";

const CONTROLS = { camera: false, chat: true, leave: true, microphone: true, screenShare: false };

const VISUALIZER = { barCount: 5, size: "lg", type: "bar" } as const;

const FADE = {
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  initial: { opacity: 0 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
};

const AGENT_STATE_LABELS: Partial<Record<AgentState, string>> = {
  connecting: "Connecting",
  initializing: "Joining",
  listening: "Listening",
  "pre-connect-buffering": "Joining",
  speaking: "Speaking",
  thinking: "Thinking",
};

interface CallContextValue {
  agentName: string;
  canCall: boolean;
  isBusy: boolean;
  isConnecting: boolean;
  startCall: (agent?: { name: string; slug: string }) => void;
  unavailableReason: string | null;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error("useCall must be used within CallApp.");
  }
  return context;
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function CallElapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <time className="numeric text-muted-foreground" dateTime={`PT${seconds}S`}>
      {formatElapsed(seconds)}
    </time>
  );
}

function CallHeader({ agentName }: { agentName: string }) {
  const { state } = useAgent();
  const label = AGENT_STATE_LABELS[state] ?? "Live";

  return (
    <header className="absolute inset-x-0 top-0 z-60 flex h-16 items-center justify-between gap-4 px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-2.5">
        <LogoMark className="hidden text-live sm:block" />
        <span className="truncate font-medium text-sm sm:text-base">{agentName}</span>
      </div>
      <div
        aria-live="polite"
        className="flex shrink-0 items-center gap-2.5 rounded-full bg-muted px-3 py-1.5 text-sm"
      >
        <LiveDot />
        <span className="font-medium">{label}</span>
        <CallElapsed />
      </div>
    </header>
  );
}

function UnavailableCallApp({
  agentName,
  children,
  unavailableReason,
}: {
  agentName: string;
  children: ReactNode;
  unavailableReason: string | null;
}) {
  const startCall = useCallback(() => undefined, []);
  const value = useMemo(
    () => ({
      agentName,
      canCall: false,
      isBusy: false,
      isConnecting: false,
      startCall,
      unavailableReason,
    }),
    [agentName, startCall, unavailableReason]
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function CallApp({
  agentName,
  agentSlug,
  canCall = true,
  children,
  unavailableReason = null,
}: {
  agentName: string;
  agentSlug: string;
  canCall?: boolean;
  children: ReactNode;
  unavailableReason?: string | null;
}) {
  if (!canCall) {
    return (
      <UnavailableCallApp agentName={agentName} unavailableReason={unavailableReason}>
        {children}
      </UnavailableCallApp>
    );
  }
  return (
    <AvailableCallApp agentName={agentName} agentSlug={agentSlug}>
      {children}
    </AvailableCallApp>
  );
}

function AvailableCallApp({
  agentName,
  agentSlug,
  children,
}: {
  agentName: string;
  agentSlug: string;
  children: ReactNode;
}) {
  const [selectedAgent, setSelectedAgent] = useState({ name: agentName, slug: agentSlug });
  const [requestId, setRequestId] = useState("");
  const [startPending, setStartPending] = useState(false);
  const tokenSource = useMemo(() => {
    const query = new URLSearchParams({ agent: selectedAgent.slug, request: requestId });
    if (typeof navigator !== "undefined" && navigator.language) {
      query.set("language", navigator.language);
    }
    return TokenSource.endpoint(`/api/v1/token?${query}`);
  }, [requestId, selectedAgent.slug]);
  const session = useSession(tokenSource);
  const { start, end } = session;
  useEffect(() => {
    if (!startPending || session.connectionState !== ConnectionState.Disconnected) {
      return;
    }
    start()
      .catch(() => {
        toast.error("Call setup failed", {
          description:
            "Check that LiveKit is running and that this browser can use your microphone.",
        });
      })
      .finally(() => setStartPending(false));
  }, [session.connectionState, start, startPending]);
  const startCall = useCallback(
    (agent?: { name: string; slug: string }) => {
      if (startPending || session.connectionState !== ConnectionState.Disconnected) {
        return;
      }
      setSelectedAgent(agent ?? { name: agentName, slug: agentSlug });
      setRequestId(crypto.randomUUID());
      setStartPending(true);
    },
    [agentName, agentSlug, session.connectionState, startPending]
  );
  const endCall = useCallback(() => end(), [end]);

  const value = useMemo(
    () => ({
      agentName: selectedAgent.name,
      canCall: true,
      isBusy: startPending || session.connectionState !== ConnectionState.Disconnected,
      isConnecting: session.connectionState === ConnectionState.Connecting,
      startCall,
      unavailableReason: null,
    }),
    [selectedAgent.name, session.connectionState, startCall, startPending]
  );

  return (
    <CallContext.Provider value={value}>
      <AgentSessionProvider session={session}>
        {children}
        <AnimatePresence>
          {session.isConnected ? (
            <motion.div
              aria-label={`Call with ${selectedAgent.name}`}
              className="fixed inset-0 z-50 bg-background"
              key="session"
              role="dialog"
              {...FADE}
            >
              <CallHeader agentName={selectedAgent.name} />
              <AgentSessionView_01
                audioVisualizer={VISUALIZER}
                className="h-full [&_[data-lk-state]]:text-live"
                controls={CONTROLS}
                isPreConnectBufferEnabled
                onDisconnect={endCall}
                preConnectMessage="Connecting you to the receptionist…"
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <StartAudioButton
          className="fixed bottom-6 left-1/2 z-60 -translate-x-1/2"
          label="Turn on call audio"
        />
      </AgentSessionProvider>
    </CallContext.Provider>
  );
}
