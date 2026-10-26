"use client";

import { LogInIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useCallback, useMemo } from "react";
import { useCall } from "@/components/call/call-app";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function TalkToAgentButton({
  agentName,
  agentSlug,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & {
  agentName?: string;
  agentSlug?: string;
}) {
  const { canCall, isBusy, isConnecting, startCall, unavailableReason } = useCall();
  const agent = useMemo(
    () => (agentName && agentSlug ? { name: agentName, slug: agentSlug } : undefined),
    [agentName, agentSlug]
  );
  const handleClick = useCallback(() => startCall(agent), [agent, startCall]);

  if (!canCall && unavailableReason) {
    return (
      <Button {...props} disabled title={unavailableReason}>
        <PhoneIcon data-icon="inline-start" />
        Talk to agent
      </Button>
    );
  }
  if (!canCall) {
    return (
      <Button nativeButton={false} render={<Link href="/login" />} {...props}>
        <LogInIcon data-icon="inline-start" />
        Sign in to try a call
      </Button>
    );
  }

  return (
    <Button disabled={isBusy} onClick={handleClick} {...props}>
      {isConnecting ? <Spinner data-icon="inline-start" /> : <PhoneIcon data-icon="inline-start" />}
      {isConnecting ? "Connecting…" : "Talk to agent"}
    </Button>
  );
}
