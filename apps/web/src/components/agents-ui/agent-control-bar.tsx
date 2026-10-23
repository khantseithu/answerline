"use client";

import { useChat } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Loader, MessageSquareTextIcon, SendHorizontal } from "lucide-react";
import { type MotionProps, motion } from "motion/react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { AgentDisconnectButton } from "@/components/agents-ui/agent-disconnect-button";
import { AgentTrackControl } from "@/components/agents-ui/agent-track-control";
import {
  AgentTrackToggle,
  agentTrackToggleVariants,
} from "@/components/agents-ui/agent-track-toggle";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  type UseInputControlsProps,
  useInputControls,
  usePublishPermissions,
} from "@/hooks/agents-ui/use-agent-control-bar";
import { cn } from "@/lib/utils";

const LK_TOGGLE_VARIANT_1 = [
  "data-[state=off]:bg-accent data-[state=off]:hover:bg-foreground/10",
  "data-[state=off]:[&_~_button]:bg-accent data-[state=off]:[&_~_button]:hover:bg-foreground/10",
  "data-[state=off]:border-border data-[state=off]:hover:border-foreground/12",
  "data-[state=off]:[&_~_button]:border-border data-[state=off]:[&_~_button]:hover:border-foreground/12",
  "data-[state=off]:text-destructive data-[state=off]:hover:text-destructive data-[state=off]:focus:text-destructive",
  "data-[state=off]:focus-visible:ring-foreground/12 data-[state=off]:focus-visible:border-ring",
  "dark:data-[state=off]:[&_~_button]:bg-accent dark:data-[state=off]:[&_~_button]:hover:bg-foreground/10",
];

const LK_TOGGLE_VARIANT_2 = [
  "data-[state=off]:bg-accent data-[state=off]:hover:bg-foreground/10",
  "data-[state=off]:border-border data-[state=off]:hover:border-foreground/12",
  "data-[state=off]:focus-visible:border-ring data-[state=off]:focus-visible:ring-foreground/12",
  "data-[state=off]:text-foreground data-[state=off]:hover:text-foreground data-[state=off]:focus:text-foreground",
  "data-[state=on]:bg-primary/12 data-[state=on]:hover:bg-primary/18",
  "data-[state=on]:border-primary/15 data-[state=on]:text-primary data-[state=on]:ring-primary/30",
  "data-[state=on]:focus-visible:border-primary/50",
];

const MOTION_PROPS: MotionProps = {
  initial: "hidden",
  transition: {
    duration: 0.3,
    ease: "easeOut",
  },
  variants: {
    hidden: {
      height: 0,
      marginBottom: 0,
      opacity: 0,
    },
    visible: {
      height: "auto",
      marginBottom: 12,
      opacity: 1,
    },
  },
};

interface AgentChatInputProps {
  chatOpen: boolean;
  className?: string;
  onSend?: (message: string) => void;
}

function AgentChatInput({ chatOpen, onSend = async () => {}, className }: AgentChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string>("");
  const isDisabled = isSending || message.trim().length === 0;

  const handleSend = async () => {
    if (isDisabled) {
      return;
    }

    try {
      setIsSending(true);
      await onSend(message.trim());
      setMessage("");
    } catch (error) {
      console.error(error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleButtonClick = async () => {
    if (isDisabled) return;
    await handleSend();
  };

  useEffect(() => {
    if (chatOpen) return;
    // when not disabled refocus on input
    inputRef.current?.focus();
  }, [chatOpen]);

  return (
    <div className={cn("mb-3 flex grow items-end gap-2 rounded-md pl-1 text-sm", className)}>
      <textarea
        autoFocus
        className="field-sizing-content max-h-16 min-h-8 flex-1 resize-none py-2 [scrollbar-width:thin] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!chatOpen || isSending}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type something..."
        ref={inputRef}
        value={message}
      />
      <Button
        className="self-end disabled:cursor-not-allowed"
        disabled={isDisabled}
        onClick={handleButtonClick}
        size="icon"
        title={isSending ? "Sending..." : "Send"}
        type="button"
        variant={isDisabled ? "secondary" : "default"}
      >
        {isSending ? <Loader className="animate-spin" /> : <SendHorizontal />}
      </Button>
    </div>
  );
}

/** Configuration for which controls to display in the AgentControlBar. */
export interface AgentControlBarControls {
  /**
   * Whether to show the camera toggle control.
   *
   * @defaultValue true (if camera publish permission is granted)
   */
  camera?: boolean;
  /**
   * Whether to show the chat toggle control.
   *
   * @defaultValue true (if data publish permission is granted)
   */
  chat?: boolean;
  /**
   * Whether to show the leave/disconnect button.
   *
   * @defaultValue true
   */
  leave?: boolean;
  /**
   * Whether to show the microphone toggle control.
   *
   * @defaultValue true (if microphone publish permission is granted)
   */
  microphone?: boolean;
  /**
   * Whether to show the screen share toggle control.
   *
   * @defaultValue true (if screen share publish permission is granted)
   */
  screenShare?: boolean;
}

export interface AgentControlBarProps extends UseInputControlsProps {
  /**
   * This takes an object with the following keys: `leave`, `microphone`, `screenShare`, `camera`,
   * `chat`. Each key maps to a boolean value that determines whether the control is displayed.
   *
   * @default
   * {
   *   leave: true,
   *   microphone: true,
   *   screenShare: true,
   *   camera: true,
   *   chat: true,
   * }
   */
  controls?: AgentControlBarControls;
  /**
   * Whether the chat input interface is open.
   *
   * @default false
   */
  isChatOpen?: boolean;
  /**
   * Whether the agent is connected to a session.
   *
   * @default false
   */
  isConnected?: boolean;
  /** The callback for when a device error occurs. */
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
  /** The callback for when the user disconnects. */
  onDisconnect?: () => void;
  /** The callback for when the chat is opened or closed. */
  onIsChatOpenChange?: (open: boolean) => void;
  /**
   * Whether to save user choices.
   *
   * @default true
   */
  saveUserChoices?: boolean;
  /**
   * The visual style of the control bar.
   *
   * @default 'default'
   */
  variant?: "default" | "outline" | "livekit";
}

/**
 * A control bar specifically designed for voice assistant interfaces. Provides controls for
 * microphone, camera, screen share, chat, and disconnect. Includes an expandable chat input for
 * text-based interaction with the agent.
 *
 * @example
 *
 * ```tsx
 * <AgentControlBar
 *   variant="livekit"
 *   isConnected={true}
 *   onDisconnect={() => handleDisconnect()}
 *   controls={{
 *     microphone: true,
 *     camera: true,
 *     screenShare: false,
 *     chat: true,
 *     leave: true,
 *   }}
 * />;
 * ```
 *
 * @extends ComponentProps<'div'>
 */
export function AgentControlBar({
  variant = "default",
  controls,
  isChatOpen = false,
  isConnected = false,
  saveUserChoices = true,
  onDisconnect,
  onDeviceError,
  onIsChatOpenChange,
  className,
  ...props
}: AgentControlBarProps & ComponentProps<"div">) {
  const { send } = useChat();
  const publishPermissions = usePublishPermissions();
  const [isChatOpenUncontrolled, setIsChatOpenUncontrolled] = useState(isChatOpen);
  const {
    microphoneTrack,
    cameraToggle,
    microphoneToggle,
    screenShareToggle,
    handleAudioDeviceChange,
    handleVideoDeviceChange,
    handleMicrophoneDeviceSelectError,
    handleCameraDeviceSelectError,
  } = useInputControls({ onDeviceError, saveUserChoices });

  const handleSendMessage = async (message: string) => {
    await send(message);
  };

  const visibleControls = {
    camera: controls?.camera ?? publishPermissions.camera,
    chat: controls?.chat ?? publishPermissions.data,
    leave: controls?.leave ?? true,
    microphone: controls?.microphone ?? publishPermissions.microphone,
    screenShare: controls?.screenShare ?? publishPermissions.screenShare,
  };

  const isEmpty = Object.values(visibleControls).every((value) => !value);

  if (isEmpty) {
    console.warn("AgentControlBar: `visibleControls` contains only false values.");
    return null;
  }

  return (
    <div
      aria-label="Voice assistant controls"
      className={cn(
        "@container/agent-control-bar bg-background border-input/50 dark:border-muted flex flex-col border p-3 drop-shadow-md/3",
        variant === "livekit" ? "rounded-[31px]" : "rounded-lg",
        className
      )}
      {...props}
    >
      <motion.div
        {...MOTION_PROPS}
        animate={isChatOpen || isChatOpenUncontrolled ? "visible" : "hidden"}
        className="border-input/50 flex w-full items-start overflow-hidden border-b"
        inert={!(isChatOpen || isChatOpenUncontrolled)}
      >
        <AgentChatInput
          chatOpen={isChatOpen || isChatOpenUncontrolled}
          className={cn(variant === "livekit" && "[&_button]:rounded-full")}
          onSend={handleSendMessage}
        />
      </motion.div>

      <div className="flex gap-1">
        <div className="flex grow gap-1">
          {/* Toggle Microphone */}
          {visibleControls.microphone && (
            <AgentTrackControl
              aria-label="Toggle microphone"
              audioTrack={microphoneTrack}
              className={cn(
                variant === "livekit" && [
                  LK_TOGGLE_VARIANT_1,
                  "rounded-full [&_button:first-child]:rounded-l-full [&_button:last-child]:rounded-r-full",
                ]
              )}
              disabled={microphoneToggle.pending}
              kind="audioinput"
              onActiveDeviceChange={handleAudioDeviceChange}
              onMediaDeviceError={handleMicrophoneDeviceSelectError}
              onPressedChange={microphoneToggle.toggle}
              pressed={microphoneToggle.enabled}
              source={Track.Source.Microphone}
              variant={variant === "outline" ? "outline" : "default"}
            />
          )}

          {/* Toggle Camera */}
          {visibleControls.camera && (
            <AgentTrackControl
              aria-label="Toggle camera"
              className={cn(
                variant === "livekit" && [
                  LK_TOGGLE_VARIANT_1,
                  "rounded-full [&_button:first-child]:rounded-l-full [&_button:last-child]:rounded-r-full",
                ]
              )}
              disabled={cameraToggle.pending}
              kind="videoinput"
              onActiveDeviceChange={handleVideoDeviceChange}
              onMediaDeviceError={handleCameraDeviceSelectError}
              onPressedChange={cameraToggle.toggle}
              pending={cameraToggle.pending}
              pressed={cameraToggle.enabled}
              source={Track.Source.Camera}
              variant={variant === "outline" ? "outline" : "default"}
            />
          )}

          {/* Toggle Screen Share */}
          {visibleControls.screenShare && (
            <AgentTrackToggle
              aria-label="Toggle screen share"
              className={cn(variant === "livekit" && [LK_TOGGLE_VARIANT_2, "rounded-full"])}
              disabled={screenShareToggle.pending}
              onPressedChange={screenShareToggle.toggle}
              pressed={screenShareToggle.enabled}
              source={Track.Source.ScreenShare}
              variant={variant === "outline" ? "outline" : "default"}
            />
          )}

          {/* Toggle Transcript */}
          {visibleControls.chat && (
            <Toggle
              aria-label="Toggle transcript"
              className={agentTrackToggleVariants({
                className: cn(variant === "livekit" && [LK_TOGGLE_VARIANT_2, "rounded-full"]),
                variant: variant === "outline" ? "outline" : "default",
              })}
              onPressedChange={(state) => {
                if (!onIsChatOpenChange) setIsChatOpenUncontrolled(state);
                else onIsChatOpenChange(state);
              }}
              pressed={isChatOpen || isChatOpenUncontrolled}
              variant={variant === "outline" ? "outline" : "default"}
            >
              <MessageSquareTextIcon />
            </Toggle>
          )}
        </div>

        {/* Disconnect */}
        {visibleControls.leave && (
          <AgentDisconnectButton
            className={cn(
              variant === "livekit" &&
                "bg-destructive/10 dark:bg-destructive/10 text-destructive hover:bg-destructive/20 dark:hover:bg-destructive/20 focus:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/4 rounded-full px-3.5 font-medium"
            )}
            disabled={!isConnected}
            onClick={onDisconnect}
          >
            <span className="sr-only @sm/agent-control-bar:not-sr-only">
              End <span className="sr-only @md/agent-control-bar:not-sr-only">call</span>
            </span>
          </AgentDisconnectButton>
        )}
      </div>
    </div>
  );
}
