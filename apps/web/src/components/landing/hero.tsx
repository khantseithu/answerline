"use client";

import { ArrowRightIcon, CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { GitHubIcon } from "@/components/brand/github-icon";
import { LiveDot } from "@/components/call/live-dot";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { Button, buttonVariants } from "@/components/ui/button";

const CLONE_COMMAND = "git clone https://github.com/khantseithu/answerline.git && pnpm bootstrap";

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copyCommand = useCallback(() => {
    navigator.clipboard.writeText(CLONE_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <section aria-labelledby="hero-heading" className="relative pt-12 pb-16 sm:pt-20 sm:pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex max-w-3xl flex-col items-start gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-3 py-1 text-muted-foreground text-xs shadow-xs">
            <LiveDot className="size-2 text-live" />
            <span className="font-medium text-foreground">Open Source</span>
            <span className="text-border">·</span>
            <span>Self-hosted voice receptionist</span>
          </div>

          <h1
            className="font-semibold text-3xl text-foreground tracking-tight sm:text-5xl sm:leading-[1.12] lg:text-6xl"
            id="hero-heading"
          >
            The open-source AI voice receptionist you own end to end
          </h1>

          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg/relaxed">
            Answer phone and web calls, query your business knowledge base, book appointments, and
            stream every turn into your own Postgres. Pluggable models, zero platform markup, and
            all code running on your infrastructure.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <TalkToAgentButton className="h-10 px-4 text-sm shadow-xs" size="lg" />
            <Link className={buttonVariants({ size: "lg", variant: "outline" })} href="/overview">
              Open dashboard
              <ArrowRightIcon className="size-4" />
            </Link>
            <a
              className={buttonVariants({ size: "lg", variant: "ghost" })}
              href="https://github.com/khantseithu/answerline"
              rel="noopener noreferrer"
              target="_blank"
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>

          <div className="mt-2 flex w-full max-w-xl items-center justify-between rounded-lg border border-border/80 bg-muted/50 px-3.5 py-2 font-mono text-muted-foreground text-xs">
            <div className="flex items-center gap-2 overflow-x-auto">
              <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
              <span className="select-all truncate text-foreground/90">{CLONE_COMMAND}</span>
            </div>
            <Button
              aria-label={copied ? "Copied command" : "Copy clone command"}
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={copyCommand}
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
        </div>
      </div>
    </section>
  );
}
