"use client";

import { PhoneIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCall } from "@/components/call/call-app";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function TalkToAgentButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { isConnecting, startCall } = useCall();

  return (
    <Button disabled={isConnecting} onClick={startCall} {...props}>
      {isConnecting ? <Spinner data-icon="inline-start" /> : <PhoneIcon data-icon="inline-start" />}
      {isConnecting ? "Connecting…" : "Talk to agent"}
    </Button>
  );
}
