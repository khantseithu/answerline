"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { activeTurnIndex } from "@/lib/calls/playback";
import { cn } from "@/lib/utils";

export interface PlaybackTurn {
  id: string;
  interrupted: boolean;
  role: "caller" | "agent";
  seekSeconds: number | null;
  text: string;
  timeLabel: string;
}

export function CallPlayback({
  audioSrc,
  turns,
}: {
  audioSrc: string | null;
  turns: PlaybackTurn[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const offsets = useMemo(() => turns.map((turn) => turn.seekSeconds), [turns]);
  const active = playing ? activeTurnIndex(offsets, currentTime) : -1;

  const stopPlaying = useCallback(() => setPlaying(false), []);
  const startPlaying = useCallback(() => setPlaying(true), []);
  const trackTime = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    setCurrentTime(event.currentTarget.currentTime);
  }, []);

  const seekTurn = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const audio = audioRef.current;
      const seconds = Number(event.currentTarget.dataset.seconds);
      if (!(audio && Number.isFinite(seconds))) {
        return;
      }
      audio.currentTime = seconds;
      audio.play().catch(stopPlaying);
    },
    [stopPlaying]
  );

  return (
    <div className="flex flex-col gap-4">
      {audioSrc ? (
        <audio
          className="w-full"
          controls
          onEnded={stopPlaying}
          onPause={stopPlaying}
          onPlay={startPlaying}
          onTimeUpdate={trackTime}
          preload="metadata"
          ref={audioRef}
          src={audioSrc}
        >
          <track kind="captions" />
        </audio>
      ) : null}
      <ol className="flex flex-col gap-1">
        {turns.map((turn, index) => {
          const isActive = index === active;
          const content = (
            <>
              <span className="numeric w-12 shrink-0 pt-0.5 text-muted-foreground text-xs">
                {turn.timeLabel}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-muted-foreground text-xs capitalize">
                  {turn.role}
                  {turn.interrupted ? " (interrupted)" : ""}
                </span>
                <span className="whitespace-pre-wrap text-sm">{turn.text}</span>
              </span>
            </>
          );
          return (
            <li key={turn.id}>
              {turn.seekSeconds === null ? (
                <div className="flex gap-3 rounded-md px-3 py-2">{content}</div>
              ) : (
                <Button
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "h-auto w-full justify-start gap-3 whitespace-normal px-3 py-2 text-left font-normal",
                    isActive && "bg-accent text-accent-foreground"
                  )}
                  data-seconds={turn.seekSeconds}
                  onClick={seekTurn}
                  type="button"
                  variant="ghost"
                >
                  {content}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
