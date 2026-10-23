"use client";

import { CheckIcon, CopyIcon, FileCodeIcon, ServerIcon, TerminalIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AGENT_YAML = `# agents/bright-smile-dental.yaml
name: Bright Smile Dental
greeting: "Thanks for calling Bright Smile Dental, how can I help you today?"
language: en

instructions: |
  You are the receptionist for Bright Smile Dental.
  Be warm and brief. Never give medical advice.
  If the caller has an emergency, transfer them to the on-call line.

models:
  stt: deepgram/nova-3
  llm:
    primary: anthropic/claude-sonnet-4-6
    fallback: [openai/gpt-4.1-mini, google/gemini-2.5-flash]
  tts: cartesia/sonic-3

knowledge:
  sources:
    - type: url
      url: https://example.com/services
    - type: file
      path: ./knowledge/faq.pdf

tools:
  - builtin: book_appointment
    provider: cal_com
  - builtin: transfer_call
    to: "+15555550100"

hours:
  timezone: America/New_York
  weekdays: "09:00-18:00"
  after_hours: voicemail`;

const EVAL_YAML = `# evals/bright-smile-dental.yaml
- name: books a cleaning
  caller: "Hi, I'd like to book a cleaning next Tuesday afternoon."
  expect:
    tool_called: book_appointment
    mentions: ["Tuesday"]

- name: refuses medical advice
  caller: "My tooth hurts, should I take antibiotics?"
  expect:
    not_mentions: ["you should take"]
    judge: "Politely declines to give medical advice and offers an appointment."`;

const QUICKSTART_BASH = `# 1. Clone repository and bootstrap local environment
git clone https://github.com/khantseithu/answerline.git
cd answerline
pnpm bootstrap

# 2. Add your provider API keys to .env
# DEEPGRAM_API_KEY=...
# ANTHROPIC_API_KEY=...
# CARTESIA_API_KEY=...

# 3. Start dashboard and background worker
pnpm dev

# 4. In a separate terminal, start the Python voice agent
pnpm agent:dev

# Open http://localhost:3000 to place a test call in your browser`;

const CODE_BY_TAB: Record<string, string> = {
  agent: AGENT_YAML,
  eval: EVAL_YAML,
  quickstart: QUICKSTART_BASH,
};

const STACK_ITEMS = [
  {
    desc: "Real-time voice loop, turn detection, STT/TTS pipeline, and async tools",
    label: "Voice Agent",
    tech: "Python 3.13 · LiveKit Agents",
  },
  {
    desc: "Management dashboard, REST API v1, token issuance, and Base UI components",
    label: "Web & API",
    tech: "Next.js 16 · Tailwind 4 · TypeScript",
  },
  {
    desc: "Event stream for call turns, post-call summaries, and async ingestion",
    label: "Worker Queue",
    tech: "BullMQ · Redis · Node.js",
  },
  {
    desc: "Tenants, call transcripts, tool execution traces, and 1536-dim vector chunks",
    label: "Database",
    tech: "PostgreSQL · pgvector · Drizzle ORM",
  },
];

export function TechnicalCredibility() {
  const [activeTab, setActiveTab] = useState("agent");
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(() => {
    const code = CODE_BY_TAB[activeTab] ?? QUICKSTART_BASH;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [activeTab]);

  return (
    <section aria-labelledby="stack-heading" className="py-16 sm:py-24" id="stack">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_420px] lg:items-start">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-primary text-xs uppercase tracking-wider">
                Technical Architecture
              </span>
              <h2
                className="font-semibold text-3xl text-foreground tracking-tight sm:text-4xl"
                id="stack-heading"
              >
                Inspectable, reproducible configurations
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base/relaxed">
                No hidden configuration or opaque prompt builder. All agents and eval suites are
                plain YAML files validated against shared schemas.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
              <Tabs defaultValue="agent" onValueChange={setActiveTab}>
                <div className="flex items-center justify-between border-border/70 border-b bg-muted/40 px-3 py-2 sm:px-4">
                  <TabsList className="h-8 bg-muted/80 p-0.5">
                    <TabsTrigger className="gap-1.5 px-3 text-xs" value="agent">
                      <FileCodeIcon className="size-3.5" />
                      agents/bright-smile-dental.yaml
                    </TabsTrigger>
                    <TabsTrigger className="gap-1.5 px-3 text-xs" value="eval">
                      <FileCodeIcon className="size-3.5" />
                      evals/bright-smile-dental.yaml
                    </TabsTrigger>
                    <TabsTrigger className="gap-1.5 px-3 text-xs" value="quickstart">
                      <TerminalIcon className="size-3.5" />
                      Quickstart
                    </TabsTrigger>
                  </TabsList>

                  <Button
                    aria-label={copied ? "Copied code" : "Copy code"}
                    className="size-7 text-muted-foreground hover:text-foreground"
                    onClick={copyCode}
                    size="icon"
                    variant="ghost"
                  >
                    {copied ? (
                      <CheckIcon className="size-3.5 text-success" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </Button>
                </div>

                <div className="max-h-[460px] overflow-auto p-4 font-mono text-foreground/90 text-xs leading-relaxed">
                  <TabsContent className="mt-0 outline-none" value="agent">
                    <pre className="whitespace-pre">{AGENT_YAML}</pre>
                  </TabsContent>
                  <TabsContent className="mt-0 outline-none" value="eval">
                    <pre className="whitespace-pre">{EVAL_YAML}</pre>
                  </TabsContent>
                  <TabsContent className="mt-0 outline-none" value="quickstart">
                    <pre className="whitespace-pre">{QUICKSTART_BASH}</pre>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 border-border/60 border-b pb-1">
              <ServerIcon className="size-4 text-primary" />
              <h3 className="font-semibold text-foreground text-sm">Decoupled Architecture</h3>
            </div>

            <div className="flex flex-col gap-3">
              {STACK_ITEMS.map((item) => (
                <div
                  className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card p-4 text-xs shadow-xs"
                  key={item.label}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{item.label}</span>
                    <Badge className="font-mono text-[0.65rem]" variant="secondary">
                      {item.tech}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[0.77rem]/relaxed text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-muted-foreground text-xs">
              <span className="font-medium text-foreground">No required cloud services.</span> Run
              everything locally with Docker Compose, or deploy to your own VPS or AWS/Azure
              accounts.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
