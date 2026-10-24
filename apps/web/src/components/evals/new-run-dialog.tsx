"use client";

import { PlayIcon, TriangleAlertIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
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
import { defaultSuiteFor } from "@/lib/evals/default-suite";
import type { EvalRunView } from "@/lib/evals/types";

export interface EvalRunOptions {
  agents: { id: string; name: string; slug: string }[];
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
  const [agentId, setAgentId] = useState(options.agents[0]?.id ?? "");
  const [suite, setSuite] = useState(
    defaultSuiteFor(options.agents[0]?.slug, options.suites) ?? ""
  );
  const [suiteChosen, setSuiteChosen] = useState(false);
  const disabled = options.agents.length === 0 || options.suites.length === 0;

  const openDialog = useCallback(() => {
    const [agent] = options.agents;
    setLiveTools(false);
    setAgentId(agent?.id ?? "");
    setSuite(defaultSuiteFor(agent?.slug, options.suites) ?? "");
    setSuiteChosen(false);
    setOpen(true);
  }, [options]);

  const handleAgentChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const agent = options.agents.find((item) => item.id === event.target.value);
      setAgentId(event.target.value);
      if (!suiteChosen) {
        setSuite(defaultSuiteFor(agent?.slug, options.suites) ?? "");
      }
    },
    [options, suiteChosen]
  );

  const handleSuiteChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setSuite(event.target.value);
    setSuiteChosen(true);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const modelOverride = String(form.get("modelOverride") ?? "").trim();
      setPending(true);
      try {
        const run = await startEvalRun({
          agentId,
          liveTools,
          mode: form.get("mode") === "audio" ? "audio" : "text",
          modelOverride: modelOverride || undefined,
          suite,
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
    [agentId, liveTools, onCreated, suite]
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
                  id="eval-agent"
                  name="agentId"
                  onChange={handleAgentChange}
                  required
                  value={agentId}
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
                  id="eval-suite"
                  name="suite"
                  onChange={handleSuiteChange}
                  required
                  value={suite}
                >
                  {options.suites.map((name) => (
                    <NativeSelectOption key={name} value={name}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  Defaults to the suite named after the agent’s slug, when one exists in the
                  repository evals folder.
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
                  <NativeSelectOption value="text">Text: scripted caller turns</NativeSelectOption>
                  <NativeSelectOption value="audio">
                    Audio: spoken caller through the full voice pipeline
                  </NativeSelectOption>
                </NativeSelect>
                <FieldDescription>
                  Text is fast and cheap. Audio adds speech-to-text and text-to-speech, so it is
                  slower and costs more.
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
