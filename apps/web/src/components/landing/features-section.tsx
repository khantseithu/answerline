import {
  BookOpenIcon,
  CalendarIcon,
  CpuIcon,
  HeadsetIcon,
  ListChecksIcon,
  PhoneIncomingIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    badge: "Active in browser · SIP planned",
    description:
      "Built on LiveKit Agents with WebRTC media transport, automated turn detection, and instant interruption handling. Live in-browser calls work today; SIP telephony via Twilio and Telnyx is planned for Milestone 4.",
    icon: PhoneIncomingIcon,
    status: "active",
    title: "Real-Time Voice Pipeline",
  },
  {
    badge: "Ingestion live · Retrieval planned",
    description:
      "Worker pipeline ingests PDFs, URLs, and Q&A documents into Postgres with chunking and 1536-dimensional embeddings. Hybrid vector and full-text search with strict agent latency budgets are on the roadmap for Milestone 2.",
    icon: BookOpenIcon,
    status: "active",
    title: "Knowledge Base Grounding",
  },
  {
    badge: "Planned (M3)",
    description:
      "Built-in integrations for Cal.com appointment booking, human call transfers, and timezone-aware business hours lookup. Includes spoken fillers while external APIs execute to keep the caller engaged.",
    icon: CalendarIcon,
    status: "planned",
    title: "Appointment Booking & Tools",
  },
  {
    badge: "Active in Postgres",
    description:
      "Every audio turn, speaker transition, latency breakdown, and tool call is queued via BullMQ and saved to Postgres. Inspect full conversation histories, timestamps, and cost per call in the dashboard.",
    icon: HeadsetIcon,
    status: "active",
    title: "Call Logs & Transcripts",
  },
  {
    badge: "Active multi-provider",
    description:
      "Zero vendor lock-in. Speech-to-text with Deepgram Nova-3, text-to-speech with Cartesia Sonic, and multi-provider LLM routing with automatic fallback across Anthropic, OpenAI, Google Gemini, and local Ollama.",
    icon: CpuIcon,
    status: "active",
    title: "Pluggable AI & Fallback Routing",
  },
  {
    badge: "Suites ready · Runner planned",
    description:
      "Write test calls as declarative scripts and replay them against your agent. Score accuracy, tool usage, latency, and token cost so you can update prompts or models without guessing.",
    icon: ListChecksIcon,
    status: "planned",
    title: "Scripted Evals & Cost Scoring",
  },
];

export function FeaturesSection() {
  return (
    <section aria-labelledby="features-heading" className="py-16 sm:py-24" id="features">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="font-semibold text-primary text-xs uppercase tracking-wider">
            Architecture & Features
          </span>
          <h2
            className="mt-1 font-semibold text-3xl text-foreground tracking-tight sm:text-4xl"
            id="features-heading"
          >
            Engineered for low latency and total control
          </h2>
          <p className="mt-3 text-muted-foreground text-sm sm:text-base/relaxed">
            Every layer of Answerline is decoupled. Run the voice loop, worker queue, and dashboard
            independently on infrastructure you manage.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-6 shadow-xs transition-colors hover:border-border"
              key={feature.title}
            >
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
                    <feature.icon className="size-4.5" />
                  </div>
                  <Badge
                    className="font-mono text-[0.6875rem]"
                    variant={feature.status === "active" ? "secondary" : "outline"}
                  >
                    {feature.badge}
                  </Badge>
                </div>

                <h3 className="font-semibold text-foreground text-lg tracking-tight">
                  {feature.title}
                </h3>

                <p className="text-muted-foreground text-xs/relaxed sm:text-sm/relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
