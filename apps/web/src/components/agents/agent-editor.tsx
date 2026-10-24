"use client";

import {
  type AgentConfig,
  type AgentVersionView,
  type AgentView,
  agentConfigSchema,
} from "@answerline/shared";
import { ArrowLeftIcon, Clock3Icon, SaveIcon } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { parse, stringify } from "yaml";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { updateAgent } from "@/lib/agents/client";
import { parseAgentYaml } from "@/lib/agents/config";

type ComplexKey = "hours" | "knowledge" | "recording" | "tools";
const COMPLEX_KEYS: ComplexKey[] = ["tools", "knowledge", "hours", "recording"];

function yamlFor(config: AgentConfig) {
  return stringify(config, { lineWidth: 100 });
}

function sectionValue(config: AgentConfig, key: ComplexKey) {
  const value = config[key];
  return value === undefined ? "" : stringify(value, { lineWidth: 100 }).trimEnd();
}

function sectionDraftsFor(config: AgentConfig): Record<ComplexKey, string> {
  return {
    hours: sectionValue(config, "hours"),
    knowledge: sectionValue(config, "knowledge"),
    recording: sectionValue(config, "recording"),
    tools: sectionValue(config, "tools"),
  };
}

function sectionConfig(config: AgentConfig, key: ComplexKey, value: unknown): AgentConfig {
  switch (key) {
    case "hours":
      return { ...config, hours: agentConfigSchema.shape.hours.parse(value) };
    case "knowledge":
      return { ...config, knowledge: agentConfigSchema.shape.knowledge.parse(value) };
    case "recording":
      return { ...config, recording: agentConfigSchema.shape.recording.parse(value) };
    case "tools":
      return { ...config, tools: agentConfigSchema.shape.tools.parse(value) };
    default: {
      const exhaustiveCheck: never = key;
      return exhaustiveCheck;
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Invalid agent configuration";
}

function validateFormConfig(
  config: AgentConfig,
  sectionErrors: Partial<Record<ComplexKey, string>>
) {
  const parsed = agentConfigSchema.safeParse(config);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Fix configuration errors before opening YAML.",
      ok: false as const,
    };
  }
  if (Object.values(sectionErrors).some(Boolean)) {
    return {
      error: "Fix invalid YAML sections before opening the full YAML editor.",
      ok: false as const,
    };
  }
  return { config: parsed.data, ok: true as const };
}

function validateRawConfig(draft: string, rawError: string) {
  if (rawError) {
    return { error: rawError, ok: false as const };
  }
  return parseAgentYaml(draft);
}

export function AgentEditor({
  agent: initialAgent,
  initialVersions,
}: {
  agent: AgentView;
  initialVersions: AgentVersionView[];
}) {
  const [agent, setAgent] = useState(initialAgent);
  const [config, setConfig] = useState(initialAgent.config);
  const [versions, setVersions] = useState(initialVersions);
  const [tab, setTab] = useState("form");
  const [rawDraft, setRawDraft] = useState(yamlFor(initialAgent.config));
  const [rawError, setRawError] = useState("");
  const [sectionDrafts, setSectionDrafts] = useState(() => sectionDraftsFor(initialAgent.config));
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<ComplexKey, string>>>({});
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleFieldChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { currentTarget } = event;
      const { value, dataset } = currentTarget;
      switch (dataset.field) {
        case "name":
          setConfig((current) => ({ ...current, name: value }));
          break;
        case "language":
          setConfig((current) => ({ ...current, language: value }));
          break;
        case "greeting":
          setConfig((current) => ({ ...current, greeting: value }));
          break;
        case "instructions":
          setConfig((current) => ({ ...current, instructions: value }));
          break;
        case "llm":
          setConfig((current) => ({
            ...current,
            models: { ...current.models, llm: { ...current.models.llm, primary: value } },
          }));
          break;
        case "fallback":
          setConfig((current) => ({
            ...current,
            models: {
              ...current.models,
              llm: {
                ...current.models.llm,
                fallback: value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              },
            },
          }));
          break;
        case "stt":
          setConfig((current) => ({ ...current, models: { ...current.models, stt: value } }));
          break;
        case "tts":
          setConfig((current) => ({ ...current, models: { ...current.models, tts: value } }));
          break;
        default:
          return;
      }
      setValidationError("");
    },
    []
  );

  const handleSectionChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const rawKey = event.currentTarget.dataset.section;
    const key = COMPLEX_KEYS.find((candidate) => candidate === rawKey);
    if (!key) {
      return;
    }
    const draft = event.currentTarget.value;
    setSectionDrafts((current) => ({ ...current, [key]: draft }));
    try {
      const value: unknown = draft.trim() ? parse(draft) : undefined;
      setConfig((current) => sectionConfig(current, key, value));
      setSectionErrors((current) => ({ ...current, [key]: undefined }));
    } catch (error) {
      setSectionErrors((current) => ({ ...current, [key]: errorMessage(error) }));
    }
  }, []);

  const handleRawChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const draft = event.currentTarget.value;
    setRawDraft(draft);
    const parsed = parseAgentYaml(draft);
    if (!parsed.ok) {
      setRawError(parsed.error);
      return;
    }
    setConfig(parsed.config);
    setSectionDrafts(sectionDraftsFor(parsed.config));
    setSectionErrors({});
    setRawError("");
  }, []);

  const changeTab = useCallback(
    (nextTab: string | null) => {
      if (!nextTab || nextTab === tab) {
        return;
      }
      const result =
        nextTab === "yaml"
          ? validateFormConfig(config, sectionErrors)
          : validateRawConfig(rawDraft, rawError);
      if (!result.ok) {
        if (nextTab === "yaml") {
          setValidationError(result.error);
        } else {
          setRawError(result.error);
        }
        return;
      }
      if (nextTab === "yaml") {
        setRawDraft(yamlFor(result.config));
        setRawError("");
      } else {
        setConfig(result.config);
        setSectionDrafts(sectionDraftsFor(result.config));
      }
      setValidationError("");
      setTab(nextTab);
    },
    [config, rawDraft, rawError, sectionErrors, tab]
  );

  const save = useCallback(async () => {
    if (saving) {
      return;
    }
    let candidate: unknown = config;
    if (tab === "yaml") {
      try {
        candidate = parse(rawDraft);
      } catch (error) {
        setRawError(errorMessage(error));
        return;
      }
    }
    if (rawError || Object.values(sectionErrors).some(Boolean)) {
      setValidationError("Resolve YAML errors before saving.");
      return;
    }
    const parsed = agentConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid agent configuration");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateAgent(agent.id, { config: parsed.data, version: agent.version });
      setAgent(updated);
      setConfig(updated.config);
      setRawDraft(yamlFor(updated.config));
      setValidationError("");
      setSectionErrors({});
      setSectionDrafts(sectionDraftsFor(updated.config));
      setVersions((current) => [
        {
          config: updated.config,
          createdAt: updated.updatedAt,
          version: updated.version,
        },
        ...current.filter((version) => version.version !== updated.version),
      ]);
      toast.success("Agent saved", { description: `Version ${updated.version}` });
    } catch (error) {
      const message = errorMessage(error);
      setValidationError(message);
      toast.error("Could not save agent", { description: message });
    } finally {
      setSaving(false);
    }
  }, [agent, config, rawDraft, rawError, saving, sectionErrors, tab]);

  return (
    <div className="flex flex-col gap-7">
      <Link
        className="inline-flex w-fit items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
        href="/agents"
      >
        <ArrowLeftIcon className="size-4" /> All agents
      </Link>
      <PageHeader
        actions={
          <>
            <TalkToAgentButton agentName={agent.name} agentSlug={agent.slug} variant="outline" />
            <Button disabled={saving} onClick={save}>
              <SaveIcon data-icon="inline-start" /> {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{agent.slug}</span>
            <Badge variant="secondary">Version {agent.version}</Badge>
          </span>
        }
        title={agent.name}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="gap-0 overflow-hidden py-0">
          <Tabs className="gap-0" onValueChange={changeTab} value={tab}>
            <div className="border-b px-5 pt-4">
              <TabsList>
                <TabsTrigger value="form">Configuration</TabsTrigger>
                <TabsTrigger value="yaml">Raw YAML</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent className="p-0" value={tab}>
              <CardContent className="p-5">
                {tab === "form" ? (
                  <div className="space-y-6">
                    <section className="grid gap-4 sm:grid-cols-2">
                      <Field id="agent-name" label="Agent name">
                        <Input
                          data-field="name"
                          id="agent-name"
                          onChange={handleFieldChange}
                          value={config.name}
                        />
                      </Field>
                      <Field id="agent-language" label="Language">
                        <Input
                          data-field="language"
                          id="agent-language"
                          onChange={handleFieldChange}
                          value={config.language}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field id="agent-greeting" label="Greeting">
                          <Textarea
                            className="min-h-24"
                            data-field="greeting"
                            id="agent-greeting"
                            onChange={handleFieldChange}
                            value={config.greeting}
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field id="agent-instructions" label="Instructions">
                          <Textarea
                            className="min-h-44"
                            data-field="instructions"
                            id="agent-instructions"
                            onChange={handleFieldChange}
                            value={config.instructions}
                          />
                        </Field>
                      </div>
                    </section>
                    <Separator />
                    <section className="space-y-4">
                      <div>
                        <h2 className="font-medium text-sm">Models</h2>
                        <p className="mt-1 text-muted-foreground text-xs">
                          Provider/model references used for each stage.
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field id="agent-llm" label="LLM primary">
                          <Input
                            className="font-mono"
                            data-field="llm"
                            id="agent-llm"
                            onChange={handleFieldChange}
                            value={config.models.llm.primary}
                          />
                        </Field>
                        <Field id="agent-fallbacks" label="LLM fallbacks (comma separated)">
                          <Input
                            className="font-mono"
                            data-field="fallback"
                            id="agent-fallbacks"
                            onChange={handleFieldChange}
                            value={config.models.llm.fallback.join(", ")}
                          />
                        </Field>
                        <Field id="agent-stt" label="Speech recognition (STT)">
                          <Input
                            className="font-mono"
                            data-field="stt"
                            id="agent-stt"
                            onChange={handleFieldChange}
                            value={config.models.stt}
                          />
                        </Field>
                        <Field id="agent-tts" label="Voice synthesis (TTS)">
                          <Input
                            className="font-mono"
                            data-field="tts"
                            id="agent-tts"
                            onChange={handleFieldChange}
                            value={config.models.tts}
                          />
                        </Field>
                      </div>
                    </section>
                    <Separator />
                    <section className="space-y-4">
                      <div>
                        <h2 className="font-medium text-sm">Tools and operating details</h2>
                        <p className="mt-1 text-muted-foreground text-xs">
                          Edit structured lists and optional sections as YAML.
                        </p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {COMPLEX_KEYS.map((key) => (
                          <Field
                            id={`agent-${key}`}
                            key={key}
                            label={key[0]?.toUpperCase() + key.slice(1)}
                          >
                            <Textarea
                              aria-invalid={Boolean(sectionErrors[key])}
                              className="min-h-40 font-mono text-xs"
                              data-section={key}
                              id={`agent-${key}`}
                              onChange={handleSectionChange}
                              spellCheck={false}
                              value={sectionDrafts[key]}
                            />
                            {sectionErrors[key] ? (
                              <p className="text-destructive text-xs">{sectionErrors[key]}</p>
                            ) : null}
                          </Field>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      This is the complete agent config. Valid changes stay in sync with the form.
                    </p>
                    <Textarea
                      aria-invalid={Boolean(rawError)}
                      className="min-h-[620px] resize-y font-mono text-xs leading-relaxed"
                      onChange={handleRawChange}
                      spellCheck={false}
                      value={rawDraft}
                    />
                    {rawError ? (
                      <p className="text-destructive text-sm" role="alert">
                        {rawError}
                      </p>
                    ) : null}
                  </div>
                )}
                {validationError ? (
                  <p className="mt-4 text-destructive text-sm" role="alert">
                    {validationError}
                  </p>
                ) : null}
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>

        <Card className="h-fit gap-0 py-0">
          <CardHeader className="border-b p-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3Icon className="size-4 text-muted-foreground" /> Version history
            </CardTitle>
            <CardDescription>Saved configurations for this agent.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {versions.map((version) => (
              <details className="group px-5 py-4" key={version.version}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm marker:hidden">
                  <span className="font-medium">Version {version.version}</span>
                  <time className="text-muted-foreground text-xs" dateTime={version.createdAt}>
                    {new Date(version.createdAt).toLocaleString()}
                  </time>
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
                  {yamlFor(version.config)}
                </pre>
              </details>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ children, id, label }: { children: ReactNode; id: string; label: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
