import { LayersIcon, PhoneCallIcon, SlidersIcon } from "lucide-react";

const STEPS = [
  {
    code: `name: Bright Smile Dental
greeting: "Thanks for calling Bright Smile Dental..."
models:
  stt: deepgram/nova-3
  llm:
    primary: anthropic/claude-sonnet
    fallback: [openai/gpt-mini, google/gemini-flash]
  tts: cartesia/sonic
tools:
  - builtin: book_appointment
    provider: cal_com`,
    description:
      "Define agent personality, system instructions, model fallback hierarchy, tools, and hours in a single YAML file versioned in your git repository.",
    icon: SlidersIcon,
    step: "01",
    title: "Configure your agent in YAML",
  },
  {
    code: `# LiveKit SIP Trunk Dispatch
trunk_id: "sip-trunk-01j9"
inbound_numbers:
  - "+15555550100"
dispatch_rule:
  agent: bright-smile-dental
  fallback_after_hours: voicemail`,
    description:
      "Test immediately in your browser via WebRTC with one click. Route inbound phone calls by connecting a SIP trunk from Twilio, Telnyx, or your preferred carrier.",
    icon: PhoneCallIcon,
    step: "02",
    title: "Connect your voice channels",
  },
  {
    code: `# Run evals before shipping prompts
docker compose run --rm worker eval agents/bright-smile-dental.yaml

# Scored metrics per run:
✓ books a cleaning: PASS (340ms, $0.012)
✓ refuses medical advice: PASS (290ms, $0.009)`,
    description:
      "Inspect turn-by-turn transcripts, latency breakdowns, and costs in your dashboard. Replay automated eval suites to verify updates before callers hear them.",
    icon: LayersIcon,
    step: "03",
    title: "Review calls and iterate with evals",
  },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="border-border/70 border-t bg-muted/20 py-16 sm:py-24"
      id="how-it-works"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="font-semibold text-primary text-xs uppercase tracking-wider">
            Operational Workflow
          </span>
          <h2
            className="mt-1 font-semibold text-3xl text-foreground tracking-tight sm:text-4xl"
            id="how-it-works-heading"
          >
            From configuration to live calls in three steps
          </h2>
          <p className="mt-3 text-muted-foreground text-sm sm:text-base/relaxed">
            No complex graphical builders that hide logic. Answerline treats voice agents as
            reproducible software artifacts.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {STEPS.map((item) => (
            <div
              className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-6 shadow-xs"
              key={item.step}
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="size-4.5" />
                  </div>
                  <span className="font-bold font-mono text-muted-foreground/50 text-sm">
                    {item.step}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <h3 className="font-semibold text-foreground text-lg tracking-tight">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-xs/relaxed sm:text-sm/relaxed">
                    {item.description}
                  </p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-3 font-mono text-[0.72rem] text-muted-foreground">
                <pre className="leading-relaxed">{item.code}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
