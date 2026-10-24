"use client";

import { LogInIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useCall } from "@/components/call/call-app";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function TalkToAgentButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { canCall, isConnecting, startCall } = useCall();

  if (!canCall) {
    return (
      <Button render={<Link href="/login" />} {...props}>
        <LogInIcon data-icon="inline-start" />
        Sign in to try a call
      </Button>
    );
  }

  return (
    <Button disabled={isConnecting} onClick={startCall} {...props}>
      {isConnecting ? <Spinner data-icon="inline-start" /> : <PhoneIcon data-icon="inline-start" />}
      {isConnecting ? "Connecting…" : "Talk to agent"}
    </Button>
  );
}
