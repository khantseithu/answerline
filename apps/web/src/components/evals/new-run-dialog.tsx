"use client";

import { PlayIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { startEvalRun } from "@/lib/evals/client";
import type { EvalRunView } from "@/lib/evals/types";

export interface EvalRunOptions {
  agents: { id: string; name: string }[];
  suites: string[];
}

export function NewRunDialog({
  onCreated,
  options,
}: {
  onCreated: (run: EvalRunView) => void;
  options: EvalRunOptions;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [liveTools, setLiveTools] = useState(false);
  const disabled = options.agents.length === 0 || options.suites.length === 0;

  const openDialog = useCallback(() => {
    setLiveTools(false);
    setOpen(true);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const modelOverride = String(form.get("modelOverride") ?? "").trim();
      setPending(true);
      try {
        const run = await startEvalRun({
          agentId: String(form.get("agentId") ?? ""),
          liveTools,
          mode: form.get("mode") === "audio" ? "audio" : "text",
          modelOverride: modelOverride || undefined,
          suite: String(form.get("suite") ?? ""),
        });
        setOpen(false);
        toast.success("Eval run queued");
        onCreated(run);
      } catch (error) {
        toast.error("Could not start eval run", {
          description: error instanceof Error ? error.message : "Try again.",
        });
      } finally {
        setPending(false);
      }
    },
    [liveTools, onCreated]
  );

  return (
    <>
      <Button disabled={disabled} onClick={openDialog}>
        <PlayIcon data-icon="inline-start" />
        New run
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-lg">
          <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Start an eval run</DialogTitle>
              <DialogDescription>
                The worker replays every case in the suite against a snapshot of the agent’s current
                config.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="eval-agent">Agent</FieldLabel>
                <NativeSelect
                  defaultValue={options.agents[0]?.id}
                  id="eval-agent"
                  name="agentId"
                  required
                >
                  {options.agents.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="eval-suite">Suite</FieldLabel>
                <NativeSelect
                  defaultValue={options.suites[0]}
                  id="eval-suite"
                  name="suite"
                  required
                >
                  {options.suites.map((suite) => (
                    <NativeSelectOption key={suite} value={suite}>
                      {suite}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  Suites are read from the repository evals folder.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="eval-model">Model override</FieldLabel>
                <Input
                  autoComplete="off"
                  id="eval-model"
                  name="modelOverride"
                  placeholder="openai/gpt-4.1-mini"
                />
                <FieldDescription>Optional. Replaces the agent’s primary LLM.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="eval-mode">Mode</FieldLabel>
                <NativeSelect defaultValue="text" id="eval-mode" name="mode">
                  <NativeSelectOption value="text">Text</NativeSelectOption>
                  <NativeSelectOption value="audio">Audio</NativeSelectOption>
                </NativeSelect>
                <FieldDescription>
                  Audio runs speech-to-text and text-to-speech, so they are slower and cost more.
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Switch checked={liveTools} id="eval-live-tools" onCheckedChange={setLiveTools} />
                <FieldContent>
                  <FieldLabel htmlFor="eval-live-tools">Use live tools</FieldLabel>
                  <FieldDescription>
                    Off by default: tool calls use the suite’s mocks.
                  </FieldDescription>
                </FieldContent>
              </Field>
              {liveTools ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>Live tools write to real systems</AlertTitle>
                  <AlertDescription>
                    Bookings, leads, voicemails, and webhooks run for real during this eval.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter>
              <Button disabled={pending} type="submit">
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                Queue run
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
