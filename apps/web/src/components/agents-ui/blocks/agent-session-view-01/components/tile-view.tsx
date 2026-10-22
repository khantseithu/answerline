import {
  type TrackReference,
  useLocalParticipant,
  useTracks,
  useVoiceAssistant,
  VideoTrack,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { type AudioVisualizerConfig } from "./agent-session-block";
import { AudioVisualizer } from "./audio-visualizer";

const ANIMATION_TRANSITION: MotionProps["transition"] = {
  damping: 75,
  mass: 1,
  stiffness: 675,
  type: "spring",
};

const tileViewClassNames = {
  // Agent
  // chatOpen: false
  // layout: Column 1 / Row 1 / Column-Span 2 / Row-Span 3
  // align: x-center y-center
  agentChatClosed: ["col-start-1 row-start-1", "col-span-2 row-span-3", "place-content-center"],
  // Agent
  // chatOpen: true,
  // hasSecondTile: false
  // layout: Column 1 / Row 1 / Column-Span 2
  // align: x-center y-center
  agentChatOpenWithoutSecondTile: ["col-start-1 row-start-1", "col-span-2", "place-content-center"],
  // Agent
  // chatOpen: true,
  // hasSecondTile: true
  // layout: Column 1 / Row 1
  // align: x-end y-center
  agentChatOpenWithSecondTile: ["col-start-1 row-start-1", "self-center justify-self-end"],
  // GRID
  // 2 Columns x 3 Rows
  grid: [
    "h-full w-full",
    "grid gap-x-2 place-content-center",
    "grid-cols-[1fr_1fr] grid-rows-[90px_1fr_90px]",
  ],
  // Second tile
  // chatOpen: false,
  // hasSecondTile: false
  // layout: Column 2 / Row 2
  // align: x-end y-end
  secondTileChatClosed: ["col-start-2 row-start-3", "place-content-end"],
  // Second tile
  // chatOpen: true,
  // hasSecondTile: true
  // layout: Column 2 / Row 1
  // align: x-start y-center
  secondTileChatOpen: ["col-start-2 row-start-1", "self-center justify-self-start"],
};

export function useLocalTrackRef(source: Track.Source) {
  const { localParticipant } = useLocalParticipant();
  const publication = localParticipant.getTrackPublication(source);
  const trackRef = useMemo<TrackReference | undefined>(
    () => (publication ? { participant: localParticipant, publication, source } : undefined),
    [source, publication, localParticipant]
  );
  return trackRef;
}

interface TileLayoutProps {
  audioVisualizer?: AudioVisualizerConfig;
  isChatOpen: boolean;
  themeMode?: "dark" | "light";
}

export function TileLayout({ themeMode, isChatOpen, audioVisualizer }: TileLayoutProps) {
  const { videoTrack: agentVideoTrack } = useVoiceAssistant();
  const [screenShareTrack] = useTracks([Track.Source.ScreenShare]);
  const cameraTrack: TrackReference | undefined = useLocalTrackRef(Track.Source.Camera);

  const isCameraEnabled = cameraTrack && !cameraTrack.publication.isMuted;
  const isScreenShareEnabled = screenShareTrack && !screenShareTrack.publication.isMuted;
  const hasSecondTile = isCameraEnabled || isScreenShareEnabled;

  const animationDelay = isChatOpen ? 0 : 0.15;
  const isAvatar = agentVideoTrack !== undefined;
  const videoWidth = agentVideoTrack?.publication.dimensions?.width ?? 0;
  const videoHeight = agentVideoTrack?.publication.dimensions?.height ?? 0;

  const { type: audioVisualizerType = "bar", ...audioVisualizerConfig } = audioVisualizer ?? {};

  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 bottom-24 z-50 @md/agent-session-block:top-12 @md/agent-session-block:bottom-40">
      <div className="relative mx-auto h-full max-w-2xl px-4 @md/agent-session-block:px-0">
        <div className={cn(tileViewClassNames.grid)}>
          {/* Agent */}
          <div
            className={cn([
              "grid",
              !isChatOpen && tileViewClassNames.agentChatClosed,
              isChatOpen && hasSecondTile && tileViewClassNames.agentChatOpenWithSecondTile,
              isChatOpen && !hasSecondTile && tileViewClassNames.agentChatOpenWithoutSecondTile,
            ])}
          >
            <AnimatePresence mode="popLayout">
              {!isAvatar && (
                // Audio Agent
                <motion.div
                  animate={{ opacity: 1 }}
                  className={cn("relative aspect-square h-[90px]")}
                  initial={{ opacity: 0 }}
                  key="agent"
                  layoutId="agent"
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                  }}
                >
                  <AudioVisualizer
                    animate={{ scale: isChatOpen ? 0.2 : 1 }}
                    className={cn(
                      "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                      "bg-background rounded-[50px] border border-transparent transition-[border,drop-shadow]",
                      isChatOpen && "border-input shadow-2xl/10 delay-200"
                    )}
                    config={audioVisualizerConfig}
                    initial={{ scale: 1 }}
                    isChatOpen={isChatOpen}
                    key="audio-visualizer"
                    style={{ color: audioVisualizer?.color }}
                    themeMode={themeMode}
                    transition={{
                      ...ANIMATION_TRANSITION,
                      delay: animationDelay,
                    }}
                    type={audioVisualizerType}
                  />
                </motion.div>
              )}

              {isAvatar && (
                // Avatar Agent
                <motion.div
                  animate={{
                    borderRadius: isChatOpen ? 6 : 12,
                    filter: "blur(0px)",
                    maskImage:
                      "radial-gradient(circle, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) 500px, transparent 500px)",
                  }}
                  className={cn(
                    "overflow-hidden bg-black drop-shadow-xl/80",
                    isChatOpen ? "h-[90px]" : "h-auto w-full"
                  )}
                  initial={{
                    filter: "blur(20px)",
                    maskImage:
                      "radial-gradient(circle, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) 20px, transparent 20px)",
                    opacity: 1,
                    scale: 1,
                  }}
                  key="avatar"
                  layoutId="avatar"
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                    filter: {
                      duration: 1,
                    },
                    maskImage: {
                      duration: 1,
                    },
                  }}
                >
                  <VideoTrack
                    className={cn(isChatOpen && "size-[90px] object-cover")}
                    height={videoHeight}
                    trackRef={agentVideoTrack}
                    width={videoWidth}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div
            className={cn([
              "grid",
              isChatOpen && tileViewClassNames.secondTileChatOpen,
              !isChatOpen && tileViewClassNames.secondTileChatClosed,
            ])}
          >
            {/* Camera & Screen Share */}
            <AnimatePresence>
              {((cameraTrack && isCameraEnabled) || (screenShareTrack && isScreenShareEnabled)) && (
                <motion.div
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  className="aspect-square size-[90px] drop-shadow-lg/20"
                  exit={{
                    opacity: 0,
                    scale: 0,
                  }}
                  initial={{
                    opacity: 0,
                    scale: 0,
                  }}
                  key="camera"
                  layout="position"
                  layoutId="camera"
                  transition={{
                    ...ANIMATION_TRANSITION,
                    delay: animationDelay,
                  }}
                >
                  <VideoTrack
                    className="bg-muted aspect-square size-[90px] rounded-md object-cover"
                    height={(cameraTrack || screenShareTrack)?.publication.dimensions?.height ?? 0}
                    trackRef={cameraTrack || screenShareTrack}
                    width={(cameraTrack || screenShareTrack)?.publication.dimensions?.width ?? 0}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
