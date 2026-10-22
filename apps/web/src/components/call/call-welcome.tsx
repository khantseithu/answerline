"use client";

import { LogoMark } from "@/components/brand/logo";
import { useCall } from "@/components/call/call-app";
import { LiveDot } from "@/components/call/live-dot";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";

export function CallWelcome() {
  const { agentName } = useCall();

  return (
    <section
      aria-labelledby="call-welcome-title"
      className="relative flex flex-col gap-8 overflow-hidden rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/6 sm:p-8 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-live/12 text-live">
          <LogoMark className="size-9" />
        </div>
        <div className="flex max-w-md flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-semibold text-xl tracking-tight" id="call-welcome-title">
              {agentName}
            </h2>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
              <LiveDot />
              Ready for calls
            </span>
          </div>
          <p className="text-muted-foreground text-sm/relaxed">
            Call your receptionist from the browser and talk to it the way a caller would: ask about
            opening hours, services, or booking a visit.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 md:items-end">
        <TalkToAgentButton className="h-10 px-4 text-[0.9375rem]" size="lg" />
        <p className="text-muted-foreground text-xs">Uses your microphone</p>
      </div>
    </section>
  );
}
