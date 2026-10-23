import {
  CalendarCheckIcon,
  CheckIcon,
  ClockIcon,
  CpuIcon,
  DollarSignIcon,
  PhoneIncomingIcon,
  SparklesIcon,
} from "lucide-react";
import { CallStatusBadge } from "@/components/call/call-status-badge";
import { LiveDot } from "@/components/call/live-dot";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { Badge } from "@/components/ui/badge";

const TURNS = [
  {
    id: "turn-1",
    role: "caller",
    speaker: "Caller",
    text: "Hi, I cracked a molar having lunch and was hoping to book an emergency dental exam sometime next Tuesday afternoon.",
    time: "0:02",
  },
  {
    id: "turn-2",
    latency: "STT: 135ms · LLM: 185ms · TTS: 65ms",
    role: "agent",
    speaker: "Bright Smile Dental",
    text: "I'm sorry to hear that! Tooth pain is never fun. We have an emergency opening with Dr. Patel next Tuesday, October 28th at 2:30 PM. Would that work for you?",
    time: "0:05",
  },
  {
    id: "turn-3",
    role: "caller",
    speaker: "Caller",
    text: "Yes, Tuesday at 2:30 PM works. Does the office accept Delta Dental PPO?",
    time: "0:12",
  },
  {
    grounding: "Matched: knowledge/faq.pdf (Delta Dental PPO accepted)",
    id: "turn-4",
    latency: "STT: 140ms · LLM: 175ms · TTS: 70ms",
    role: "agent",
    speaker: "Bright Smile Dental",
    text: "Yes, Bright Smile Dental accepts Delta Dental PPO. I'll reserve Tuesday at 2:30 PM for you with Dr. Patel right now—may I have your full name and phone number?",
    time: "0:16",
  },
];

export function CallConsoleVisual() {
  return (
    <section
      aria-labelledby="product-visual-heading"
      className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2
              className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
              id="product-visual-heading"
            >
              Illustrative Call Inspection
            </h2>
            <p className="mt-0.5 font-semibold text-foreground text-lg tracking-tight sm:text-xl">
              Every turn, tool call, and latency metric captured
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            Based on{" "}
            <code className="numeric text-foreground">agents/bright-smile-dental.yaml</code>
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm ring-1 ring-foreground/5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-border/70 border-b bg-muted/40 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className="flex items-center gap-1.5">
                <div className="size-2.5 rounded-full bg-border" />
                <div className="size-2.5 rounded-full bg-border" />
                <div className="size-2.5 rounded-full bg-border" />
              </div>
              <div className="h-4 w-px bg-border/70" />
              <div className="flex items-center gap-2">
                <span className="font-medium font-mono text-foreground text-xs">
                  call_01j9a8b7c
                </span>
                <span className="hidden text-muted-foreground text-xs md:inline">
                  room_bright-smile-dental_web
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CallStatusBadge status="completed" />
              <Badge className="hidden font-mono text-xs sm:inline-flex" variant="outline">
                Deepgram · Claude · Cartesia
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-border/70 border-border/70 border-b bg-card text-xs sm:grid-cols-4 sm:divide-y-0">
            <div className="flex flex-col gap-1 p-3.5 sm:px-5 sm:py-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <PhoneIncomingIcon className="size-3.5" /> Channel
              </span>
              <span className="font-medium text-foreground">In-browser WebRTC</span>
            </div>
            <div className="flex flex-col gap-1 p-3.5 sm:px-5 sm:py-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ClockIcon className="size-3.5" /> Duration
              </span>
              <span className="numeric font-medium font-mono text-foreground">1m 42s</span>
            </div>
            <div className="flex flex-col gap-1 p-3.5 sm:px-5 sm:py-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CpuIcon className="size-3.5" /> Avg Latency
              </span>
              <span className="numeric font-medium font-mono text-foreground">385ms TTFT</span>
            </div>
            <div className="flex flex-col gap-1 p-3.5 sm:px-5 sm:py-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <DollarSignIcon className="size-3.5" /> Provider Cost
              </span>
              <span className="numeric font-medium font-mono text-foreground">$0.014</span>
            </div>
          </div>

          <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-border/60 border-b pb-1">
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Live Transcript Stream
                </span>
                <span className="font-mono text-muted-foreground text-xs">4 turns logged</span>
              </div>

              <div className="flex flex-col gap-3">
                {TURNS.map((turn) => (
                  <div
                    className={`flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                      turn.role === "agent"
                        ? "border border-border/60 bg-muted/40"
                        : "border border-border/40 bg-background"
                    }`}
                    key={turn.id}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {turn.role === "agent" ? <LiveDot className="size-1.5 text-live" /> : null}
                        <span className="font-medium text-foreground">{turn.speaker}</span>
                      </div>
                      <span className="numeric font-mono text-[0.7rem] text-muted-foreground">
                        {turn.time}
                      </span>
                    </div>

                    <p className="text-foreground/90 text-sm/relaxed">{turn.text}</p>

                    {turn.latency ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 border-border/40 border-t pt-1 text-[0.7rem] text-muted-foreground">
                        <span className="numeric font-mono">{turn.latency}</span>
                        {turn.grounding ? (
                          <span className="font-medium text-primary">· {turn.grounding}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-border/60 border-b pb-1">
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Tool & Outcome
                </span>
                <Badge className="h-5 px-1.5 text-[0.65rem]" variant="secondary">
                  Postgres
                </Badge>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Caller Intent</span>
                  <Badge
                    className="h-5 border-none bg-info/10 px-1.5 text-[0.65rem] text-info"
                    variant="secondary"
                  >
                    Appointment Booking
                  </Badge>
                </div>
                <p className="font-medium text-foreground text-xs">Emergency dental examination</p>
              </div>

              <div className="flex flex-col gap-2.5 rounded-xl border border-success/30 bg-success/5 p-3.5">
                <div className="flex items-center gap-1.5 font-medium text-success text-xs">
                  <CalendarCheckIcon className="size-4" />
                  <span>book_appointment</span>
                </div>
                <div className="space-y-1 rounded-md border border-border/50 bg-card/60 p-2 font-mono text-[0.7rem] text-muted-foreground">
                  <div>provider: &quot;cal_com&quot;</div>
                  <div>service: &quot;emergency_exam&quot;</div>
                  <div>datetime: &quot;2026-10-28T14:30:00&quot;</div>
                </div>
                <div className="flex items-center gap-1.5 pt-1 font-medium text-success text-xs">
                  <CheckIcon className="size-3.5" />
                  <span>Booking confirmed #CAL-94018</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background p-3.5 text-xs">
                <span className="font-medium text-muted-foreground">Post-Call Pipeline</span>
                <ul className="space-y-1.5 text-[0.75rem] text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <CheckIcon className="size-3 shrink-0 text-success" />
                    <span>
                      BullMQ job <code className="numeric">call.ended</code> dispatched
                    </span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckIcon className="size-3 shrink-0 text-success" />
                    <span>Full transcript saved to Postgres</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckIcon className="size-3 shrink-0 text-success" />
                    <span>Cost calculated at $0.014</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
                <div className="flex items-center gap-1.5 font-medium text-primary text-xs">
                  <SparklesIcon className="size-3.5" />
                  <span>Try it live right now</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Click to launch a live browser call with this dental receptionist.
                </p>
                <TalkToAgentButton className="mt-1 w-full justify-center" size="sm" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
