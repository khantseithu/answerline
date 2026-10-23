"use client";

import type { AgentState } from "@livekit/components-react";
import { PhoneOffIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const AGENTS = [
  { label: "Bright Smile Dental", value: "bright-smile-dental" },
  { label: "After-hours line", value: "after-hours" },
  { label: "Front desk (Spanish)", value: "front-desk-es" },
];

export function SelectDemo() {
  return (
    <Field>
      <FieldLabel htmlFor="answering-agent">Answering agent</FieldLabel>
      <Select defaultValue="bright-smile-dental" items={AGENTS}>
        <SelectTrigger className="w-full" id="answering-agent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENTS.map((agent) => (
            <SelectItem key={agent.value} value={agent.value}>
              {agent.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>Picks up every call to this number.</FieldDescription>
    </Field>
  );
}

export function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Remove number</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove +1 (555) 010-0142?</DialogTitle>
          <DialogDescription>
            Callers to this number will no longer reach Bright Smile Dental. You can add it again
            later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep number</DialogClose>
          <DialogClose render={<Button variant="destructive" />}>Remove number</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TOASTS = [
  {
    label: "Success",
    show: () =>
      toast.success("Appointment booked", {
        description: "Cleaning on Tue, Nov 4 at 2:30 PM for Dana Whitfield.",
      }),
  },
  {
    label: "Info",
    show: () => toast.info("Call transferred", { description: "Sent to the on-call line." }),
  },
  {
    label: "Warning",
    show: () =>
      toast.warning("Slow responses", {
        description: "Median latency is 1.4 s over the last 10 calls.",
      }),
  },
  {
    label: "Error",
    show: () =>
      toast.error("Call setup failed", {
        description: "Check that LiveKit is running and that this browser can use your microphone.",
      }),
  },
];

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      {TOASTS.map((item) => (
        <Button key={item.label} onClick={item.show} variant="outline">
          {item.label}
        </Button>
      ))}
    </div>
  );
}

const SPEAKING_FRAMES = [
  [0.2, 0.55, 0.8, 0.45, 0.25],
  [0.35, 0.75, 0.6, 0.7, 0.3],
  [0.25, 0.5, 0.95, 0.5, 0.2],
  [0.4, 0.65, 0.7, 0.85, 0.35],
  [0.15, 0.45, 0.55, 0.4, 0.15],
];

const STILL_FRAME = [0.25, 0.6, 0.85, 0.5, 0.3];

function useSpeakingBands() {
  const reduceMotion = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const id = window.setInterval(() => {
      setFrame((current) => (current + 1) % SPEAKING_FRAMES.length);
    }, 180);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return reduceMotion ? STILL_FRAME : (SPEAKING_FRAMES[frame] ?? STILL_FRAME);
}

const VISUALIZER_STATES: { label: string; note: string; state: AgentState }[] = [
  { label: "Connecting", note: "Bars sweep inward", state: "connecting" },
  { label: "Listening", note: "Center bar breathes", state: "listening" },
  { label: "Thinking", note: "Center bar flickers", state: "thinking" },
  { label: "Speaking", note: "Bars follow the voice", state: "speaking" },
];

export function VisualizerDemo() {
  const bands = useSpeakingBands();

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {VISUALIZER_STATES.map((item) => (
        <figure
          className="flex flex-col items-center gap-4 rounded-xl bg-muted/60 px-4 pt-6 pb-4"
          key={item.state}
        >
          <AgentAudioVisualizerBar
            barCount={5}
            className="h-28 text-live *:transition-[height,background-color] *:duration-150"
            size="md"
            state={item.state}
            volumeBands={item.state === "speaking" ? bands : undefined}
          />
          <figcaption className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-medium text-sm">{item.label}</span>
            <span className="text-muted-foreground text-xs">{item.note}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function MotionDemo() {
  const [shown, setShown] = useState(true);
  const toggle = useCallback(() => setShown((value) => !value), []);

  return (
    <div className="flex flex-col items-start gap-4">
      <Button onClick={toggle} size="sm" variant="outline">
        {shown ? "Hide panel" : "Show panel"}
      </Button>
      <div
        aria-hidden={!shown}
        className={cn(
          "flex w-full max-w-xs items-center gap-3 rounded-xl bg-card p-3 shadow-md ring-1 ring-foreground/6 transition-[opacity,translate] duration-(--duration-base) ease-out",
          shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        )}
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-destructive/12 text-destructive">
          <PhoneOffIcon className="size-4" />
        </span>
        <span className="flex flex-col">
          <span className="font-medium text-sm">Call ended</span>
          <span className="numeric text-muted-foreground text-xs">03:42</span>
        </span>
      </div>
    </div>
  );
}
