"use client";

import { PlusIcon } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { addPhoneNumber } from "@/lib/phone-numbers/client";
import type { AgentOption } from "@/lib/phone-numbers/types";
import { AgentSelect } from "./agent-select";

export function AddNumber({
  agents,
  onChange,
}: {
  agents: AgentOption[];
  onChange: () => Promise<void>;
}) {
  const [agent, setAgent] = useState<string | null>(agents[0]?.slug ?? null);
  const [pending, setPending] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const number = String(new FormData(form).get("number") ?? "").trim();
      const chosen = agent ?? agents[0]?.slug;
      if (!chosen) {
        toast.error("Create an agent before connecting a number");
        return;
      }
      setPending(true);
      try {
        await addPhoneNumber({ agent: chosen, number });
        form.reset();
        toast.success("Phone number connected");
        await onChange();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      } finally {
        setPending(false);
      }
    },
    [agent, agents, onChange]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a number</CardTitle>
        <CardDescription>
          Point your SIP trunk at this server first, then add the number here and choose who
          answers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="max-w-xl" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="phone-number">Phone number</FieldLabel>
              <Input
                autoComplete="off"
                id="phone-number"
                inputMode="tel"
                name="number"
                placeholder="+15551234567"
                required
                type="tel"
              />
              <FieldDescription>
                International format, starting with + and the country code.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="phone-number-agent">Agent</FieldLabel>
              <AgentSelect
                agents={agents}
                id="phone-number-agent"
                label="Agent that answers the new number"
                onChange={setAgent}
                value={agent}
              />
            </Field>
            <Button className="self-start" disabled={pending || agents.length === 0} type="submit">
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Connect number
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
