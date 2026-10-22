"use client";

import { useAgent, useSessionContext, useSessionMessages } from "@livekit/components-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import React, { useEffect, useRef, useState } from "react";
import { type AgentAudioVisualizerAuraProps } from "@/components/agents-ui/agent-audio-visualizer-aura";
import { type AgentAudioVisualizerBarProps } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { type AgentAudioVisualizerGridProps } from "@/components/agents-ui/agent-audio-visualizer-grid";
import { type AgentAudioVisualizerRadialProps } from "@/components/agents-ui/agent-audio-visualizer-radial";
import { type AgentAudioVisualizerWaveProps } from "@/components/agents-ui/agent-audio-visualizer-wave";
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript";
import {
  AgentControlBar,
  type AgentControlBarControls,
} from "@/components/agents-ui/agent-control-bar";
import { cn } from "@/lib/utils";
import { TileLayout } from "./tile-view";

/**
 * Configures the visualizer style rendered in the main tile area. `type` selects the
 * visualizer, and the remaining fields are exactly the props of the matching
 * `AgentAudioVisualizer*` component (e.g. `type: 'grid'` accepts `rowCount`/`columnCount`,
 * `type: 'wave'` accepts `lineWidth`, etc).
 */
export type AudioVisualizerConfig =
  | ({ type?: "bar" } & AgentAudioVisualizerBarProps)
  | ({ type: "wave" } & AgentAudioVisualizerWaveProps)
  | ({ type: "grid" } & AgentAudioVisualizerGridProps)
  | ({ type: "radial" } & AgentAudioVisualizerRadialProps)
  | ({ type: "aura" } & AgentAudioVisualizerAuraProps);

const DEFAULT_CONTROLS: AgentControlBarControls = {
  camera: false,
  chat: false,
  leave: true,
  microphone: true,
  screenShare: false,
};

const BOTTOM_VIEW_MOTION_PROPS: MotionProps = {
  animate: "visible",
  exit: "hidden",
  initial: "hidden",
  transition: {
    delay: 0.5,
    duration: 0.3,
    ease: "easeOut",
  },
  variants: {
    hidden: {
      opacity: 0,
      translateY: "100%",
    },
    visible: {
      opacity: 1,
      translateY: "0%",
    },
  },
};

const CHAT_MOTION_PROPS: MotionProps = {
  animate: "visible",
  exit: "hidden",
  initial: "hidden",
  variants: {
    hidden: {
      opacity: 0,
      transition: {
        duration: 0.3,
        ease: "easeOut",
      },
    },
    visible: {
      opacity: 1,
      transition: {
        delay: 0.2,
        duration: 0.3,
        ease: "easeOut",
      },
    },
  },
};

const SHIMMER_MOTION_PROPS: MotionProps = {
  animate: "visible",
  exit: "hidden",
  initial: "hidden",
  variants: {
    hidden: {
      opacity: 0,
      transition: {
        delay: 0,
        duration: 0.5,
        ease: "easeIn",
      },
    },
    visible: {
      opacity: 1,
      transition: {
        delay: 0.8,
        duration: 0.5,
        ease: "easeIn",
      },
    },
  },
};

interface FadeProps {
  bottom?: boolean;
  className?: string;
  top?: boolean;
}

export function Fade({ top = false, bottom = false, className }: FadeProps) {
  return (
    <div
      className={cn(
        "from-background pointer-events-none h-4 bg-linear-to-b to-transparent",
        top && "bg-linear-to-b",
        bottom && "bg-linear-to-t",
        className
      )}
    />
  );
}

export interface AgentSessionView_01Props {
  /**
   * Configures the visualizer style rendered in the main tile area.
   *
   * @default { type: 'bar' }
   */
  audioVisualizer?: AudioVisualizerConfig;
  /** Optional class name merged onto the outer `<section>` container. */
  className?: string;
  /**
   * An object with the following keys: leave, microphone, screenShare, camera, chat.
   * Each key maps to a boolean value that determines whether the control is displayed.
   *
   * @default {
   *   leave: true,
   *   microphone: true,
   *   chat: false,
   *   camera: false,
   *   screenShare: false,
   * }
   */
  controls?: AgentControlBarControls;
  /**
   * Shows a pre-connect buffer state with a shimmer message before messages appear.
   *
   * @default true
   */
  isPreConnectBufferEnabled?: boolean;
  /** Called when the user clicks the leave control, in addition to ending the session. */
  onDisconnect?: () => void;
  /**
   * Message shown above the controls before the first chat message is sent.
   *
   * @default 'Agent is listening, ask it a question'
   */
  preConnectMessage?: string;
  /**
   * Theme mode forwarded to the aura visualizer (`audioVisualizer.type === 'aura'`) so
   * the shader's blend mode adapts to the theme mode.
   * Ignored by other visualizer types.
   */
  themeMode?: "dark" | "light";
}

export function AgentSessionView_01({
  preConnectMessage = "Agent is listening, ask it a question",
  controls = DEFAULT_CONTROLS,
  isPreConnectBufferEnabled = true,
  audioVisualizer = { type: "bar" },
  themeMode,
  onDisconnect,
  ref,
  className,
  ...props
}: React.ComponentProps<"section"> & AgentSessionView_01Props) {
  const session = useSessionContext();
  const { messages } = useSessionMessages(session);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { state: agentState } = useAgent();

  useEffect(() => {
    const lastMessage = messages.at(-1);
    const lastMessageIsLocal = lastMessage?.from?.isLocal === true;

    if (scrollAreaRef.current && lastMessageIsLocal) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const finalControls = {
    ...DEFAULT_CONTROLS,
    ...controls,
  };

  return (
    <section
      className={cn(
        "@container/agent-session-block bg-background relative z-10 h-full w-full overflow-hidden",
        className
      )}
      ref={ref}
      {...props}
    >
      <Fade className="absolute inset-x-4 top-0 z-10 h-40" top />
      {/* transcript */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            {...CHAT_MOTION_PROPS}
            className="absolute inset-x-0 top-0 bottom-[135px] overflow-hidden @md/agent-session-block:bottom-[170px]"
          >
            <AgentChatTranscript
              agentState={agentState}
              className="mx-auto max-w-2xl **:data-[slot=message-scroller-content]:p-4 **:data-[slot=message-scroller-content]:pt-40! @md/agent-session-block:**:data-[slot=message-scroller-content]:p-6"
              messages={messages}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tile layout */}
      <TileLayout audioVisualizer={audioVisualizer} isChatOpen={isChatOpen} themeMode={themeMode} />

      {/* Bottom */}
      <motion.div
        {...BOTTOM_VIEW_MOTION_PROPS}
        className="absolute inset-x-3 bottom-0 z-50 @md/agent-session-block:inset-x-12"
      >
        {/* Pre-connect message */}
        {isPreConnectBufferEnabled && (
          <AnimatePresence>
            {messages.length === 0 && (
              <motion.p
                aria-hidden={messages.length > 0}
                key="pre-connect-message"
                {...SHIMMER_MOTION_PROPS}
                className="shimmer shimmer-duration-2000 pointer-events-none mx-auto block w-full max-w-2xl pb-4 text-center text-sm text-muted-foreground"
              >
                {preConnectMessage}
              </motion.p>
            )}
          </AnimatePresence>
        )}
        <div className="bg-background relative mx-auto max-w-2xl pb-3 @md/agent-session-block:pb-12">
          <AgentControlBar
            controls={finalControls}
            isChatOpen={isChatOpen}
            isConnected={session.isConnected}
            onDisconnect={onDisconnect ?? session.end}
            onIsChatOpenChange={setIsChatOpen}
            variant="livekit"
          />
        </div>
      </motion.div>
    </section>
  );
}
