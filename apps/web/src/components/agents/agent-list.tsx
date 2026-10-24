"use client";

import type { AgentTemplate, AgentView } from "@answerline/shared";
import { ArrowUpRightIcon, HeadsetIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type MouseEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAgent } from "@/lib/agents/client";

export function AgentList({
  agents,
  templates,
}: {
  agents: AgentView[];
  templates: AgentTemplate[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState("");
  const [selected, setSelected] = useState<AgentTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const visibleTemplates = useMemo(
    () =>
      templates.filter((template) =>
        template.config.name.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [query, templates]
  );

  const chooseTemplate = useCallback(
    (template: AgentTemplate) => {
      setSelected(template);
      const usedSlugs = new Set(agents.map((agent) => agent.slug));
      let candidate = template.slug;
      let suffix = 2;
      while (usedSlugs.has(candidate)) {
        candidate = `${template.slug.slice(0, 52)}-copy-${suffix}`;
        suffix += 1;
      }
      setSlug(candidate);
    },
    [agents]
  );

  const createFromTemplate = useCallback(async () => {
    if (!selected || creating) {
      return;
    }
    setCreating(true);
    try {
      const agent = await createAgent({ config: selected.config, slug });
      setOpen(false);
      router.push(`/agents/${agent.id}`);
    } catch (error) {
      toast.error("Could not create agent", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setCreating(false);
    }
  }, [creating, router, selected, slug]);
  const openTemplatePicker = useCallback(() => setOpen(true), []);
  const updateQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.currentTarget.value);
  }, []);
  const updateSlug = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSlug(event.currentTarget.value);
  }, []);
  const selectTemplate = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const template = templates.find((item) => item.slug === event.currentTarget.dataset.slug);
      if (template) {
        chooseTemplate(template);
      }
    },
    [chooseTemplate, templates]
  );

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Card className="group gap-0 overflow-hidden py-0" key={agent.id}>
            <CardHeader className="gap-3 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/10">
                  <HeadsetIcon className="size-5" />
                </div>
                <Badge variant="secondary">v{agent.version}</Badge>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{agent.name}</CardTitle>
                <CardDescription className="font-mono text-xs">{agent.slug}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3 border-t bg-muted/30 p-4">
              <Link
                className="inline-flex items-center gap-1 font-medium text-foreground/80 text-sm transition-colors hover:text-foreground"
                href={`/agents/${agent.id}`}
              >
                Configure <ArrowUpRightIcon className="size-3.5" />
              </Link>
              <TalkToAgentButton
                agentName={agent.name}
                agentSlug={agent.slug}
                size="sm"
                variant="outline"
              />
            </CardContent>
          </Card>
        ))}
        <button
          className="group flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 p-6 text-center transition-colors hover:border-primary/35 hover:bg-primary/[0.025]"
          onClick={openTemplatePicker}
          type="button"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <PlusIcon className="size-5" />
          </span>
          <span>
            <span className="block font-medium text-sm">Create an agent</span>
            <span className="mt-1 block text-muted-foreground text-xs">
              Start with one of {templates.length} industry templates
            </span>
          </span>
        </button>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[min(90dvh,800px)] max-w-2xl grid-rows-[auto_1fr_auto] overflow-hidden p-0">
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle>Choose a starting point</DialogTitle>
            <DialogDescription>
              Pick a template, then adjust its name and configuration for your business.
            </DialogDescription>
            <div className="relative mt-2">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search templates"
                className="pl-9"
                onChange={updateQuery}
                placeholder="Search 30 templates…"
                value={query}
              />
            </div>
          </DialogHeader>
          <div className="grid min-h-0 gap-2 overflow-y-auto px-5 py-4 sm:grid-cols-2">
            {visibleTemplates.map((template) => (
              <button
                aria-pressed={selected?.slug === template.slug}
                className="flex min-h-20 flex-col items-start justify-center gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 aria-pressed:border-primary aria-pressed:bg-primary/[0.04]"
                data-slug={template.slug}
                key={template.slug}
                onClick={selectTemplate}
                type="button"
              >
                <span className="font-medium text-sm">{template.config.name}</span>
                <span className="line-clamp-2 text-muted-foreground text-xs">
                  {template.config.greeting}
                </span>
              </button>
            ))}
            {visibleTemplates.length === 0 ? (
              <p className="py-10 text-center text-muted-foreground text-sm sm:col-span-2">
                No templates match “{query}”.
              </p>
            ) : null}
          </div>
          <DialogFooter className="items-center sm:flex-row sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs sm:max-w-sm">
              <Label htmlFor="agent-slug">Slug</Label>
              <Input
                aria-label="Agent slug"
                className="font-mono text-foreground"
                disabled={!selected}
                id="agent-slug"
                maxLength={63}
                onChange={updateSlug}
                pattern="[a-z0-9][a-z0-9-]{0,62}"
                value={slug}
              />
            </div>
            <Button disabled={!selected || creating || !slug} onClick={createFromTemplate}>
              {creating ? "Creating…" : "Create agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
