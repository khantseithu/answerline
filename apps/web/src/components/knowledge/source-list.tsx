"use client";

import { format } from "date-fns";
import {
  AlignLeftIcon,
  BookOpenIcon,
  FileTextIcon,
  GlobeIcon,
  type LucideIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EmptyPanel } from "@/components/shell/empty-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteKnowledgeSource, resyncKnowledgeSource } from "@/lib/knowledge/client";
import {
  isInFlight,
  type KnowledgeSourceType,
  type KnowledgeSourceView,
} from "@/lib/knowledge/types";
import { KnowledgeStatusBadge } from "./status-badge";

const TYPE: Record<KnowledgeSourceType, { icon: LucideIcon; label: string }> = {
  file: { icon: FileTextIcon, label: "File" },
  qa: { icon: MessagesSquareIcon, label: "Q&A" },
  text: { icon: AlignLeftIcon, label: "Text" },
  url: { icon: GlobeIcon, label: "Web page" },
};

function describe(source: KnowledgeSourceView) {
  switch (source.type) {
    case "qa":
      return `${source.itemCount ?? 0} Q&A pair${source.itemCount === 1 ? "" : "s"}`;
    case "text":
      return `${(source.itemCount ?? 0).toLocaleString("en-US")} characters`;
    case "url":
      return source.title ? source.uri : null;
    default:
      return null;
  }
}

function sourceName(source: KnowledgeSourceView) {
  return source.title ?? source.uri ?? "Untitled source";
}

function SourceRow({
  onChange,
  source,
}: {
  onChange: () => Promise<void>;
  source: KnowledgeSourceView;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { icon: Icon, label } = TYPE[source.type];
  const detail = describe(source);
  const name = sourceName(source);

  const run = useCallback(
    async (action: () => Promise<void>, success: string) => {
      setBusy(true);
      try {
        await action();
        toast.success(success);
        await onChange();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );
  const handleResync = useCallback(
    () => run(() => resyncKnowledgeSource(source.id), "Re-sync queued"),
    [run, source.id]
  );
  const handleDelete = useCallback(
    () => run(() => deleteKnowledgeSource(source.id), "Source deleted"),
    [run, source.id]
  );
  const openConfirm = useCallback(() => setConfirmOpen(true), []);

  return (
    <TableRow>
      <TableCell className="w-28 align-top">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4 shrink-0" />
          {label}
        </span>
      </TableCell>
      <TableCell className="min-w-56 max-w-0 whitespace-normal align-top">
        <p className="truncate font-medium" title={name}>
          {name}
        </p>
        {detail ? (
          <p className="truncate text-muted-foreground text-xs" title={detail}>
            {detail}
          </p>
        ) : null}
        {source.status === "failed" && source.error ? (
          <p
            className="mt-1 line-clamp-2 text-destructive text-xs"
            role="alert"
            title={source.error}
          >
            {source.error}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        <KnowledgeStatusBadge status={source.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap align-top text-muted-foreground">
        {source.ingestedAt ? (
          <time dateTime={source.ingestedAt} suppressHydrationWarning>
            {format(new Date(source.ingestedAt), "MMM d, HH:mm")}
          </time>
        ) : (
          "Never"
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex justify-end gap-1">
          <Button
            aria-label={`Re-sync ${name}`}
            disabled={busy || isInFlight(source.status)}
            onClick={handleResync}
            size="sm"
            variant="ghost"
          >
            <RefreshCwIcon data-icon="inline-start" />
            Re-sync
          </Button>
          <Button
            aria-label={`Delete ${name}`}
            disabled={busy}
            onClick={openConfirm}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
        <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this source?</AlertDialogTitle>
              <AlertDialogDescription>
                {`"${name}" and everything indexed from it will be removed. Your receptionist will stop answering from it.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep source</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} variant="destructive">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function SourceList({
  onChange,
  sources,
}: {
  onChange: () => Promise<void>;
  sources: KnowledgeSourceView[];
}) {
  if (!sources.length) {
    return (
      <EmptyPanel
        description="Add a web page, upload a PDF, or write question-and-answer pairs above. Your receptionist answers from them during calls."
        icon={BookOpenIcon}
        title="No sources yet"
      />
    );
  }

  return (
    <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
      <h2 className="font-semibold text-base" id="sources-heading">
        Sources
      </h2>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last ingested</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <SourceRow key={source.id} onChange={onChange} source={source} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
