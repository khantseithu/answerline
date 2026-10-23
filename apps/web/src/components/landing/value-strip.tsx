import { ActivityIcon, DatabaseIcon, FileCode2Icon, KeyRoundIcon } from "lucide-react";

const VALUES = [
  {
    description:
      "Audio recordings, transcripts, and caller logs remain in your Postgres and local object store. No external telemetry or AI training on your customer conversations.",
    icon: DatabaseIcon,
    subhead: "Your Postgres, your storage",
    title: "Self-Hosted Data",
  },
  {
    description:
      "Pluggable STT, LLM, and TTS providers. Connect Deepgram, Anthropic, Cartesia, OpenAI, or run local models on Ollama with zero per-minute platform markup.",
    icon: KeyRoundIcon,
    subhead: "Direct provider pricing",
    title: "Bring Your Own Keys",
  },
  {
    description:
      "Each receptionist is configured via a single declarative YAML file. Prompts, routing fallbacks, tool definitions, and operating hours stay versioned in git.",
    icon: FileCode2Icon,
    subhead: "Code and config, not a builder",
    title: "Config-Driven YAML",
  },
  {
    description:
      "Track TTFT and per-turn token costs down to the cent. Replay automated eval test suites to verify accuracy and tool calling before callers ever hear changes.",
    icon: ActivityIcon,
    subhead: "First-class evals & latency",
    title: "Measurable Quality",
  },
];

export function ValueStrip() {
  return (
    <section
      aria-labelledby="values-heading"
      className="border-border/70 border-y bg-muted/30 py-14 sm:py-16"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2
            className="font-semibold text-2xl text-foreground tracking-tight sm:text-3xl"
            id="values-heading"
          >
            Built on core open-source principles
          </h2>
          <p className="mt-2 text-muted-foreground text-sm sm:text-base">
            Hosted voice platforms lock your call logs behind markups and proprietary APIs.
            Answerline is built for teams who need complete ownership.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((item) => (
            <div
              className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-5 shadow-xs transition-colors hover:border-border"
              key={item.title}
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon className="size-4.5" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-base text-foreground tracking-tight">
                  {item.title}
                </h3>
                <span className="font-medium text-primary text-xs">{item.subhead}</span>
              </div>
              <p className="text-muted-foreground text-xs/relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
