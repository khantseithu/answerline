import { CheckIcon, CircleAlertIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { KnowledgeSourceStatus } from "@/lib/knowledge/types";
import { cn } from "@/lib/utils";

const STATUS: Record<KnowledgeSourceStatus, { className: string; label: string }> = {
  failed: { className: "bg-destructive/12 text-destructive", label: "Failed" },
  pending: { className: "bg-muted text-muted-foreground", label: "Queued" },
  processing: { className: "bg-info/12 text-info", label: "Processing" },
  ready: { className: "bg-success/12 text-success", label: "Ready" },
};

function StatusIcon({ status }: { status: KnowledgeSourceStatus }) {
  switch (status) {
    case "failed":
      return <CircleAlertIcon data-icon="inline-start" />;
    case "pending":
      return <ClockIcon data-icon="inline-start" />;
    case "processing":
      return (
        <Spinner aria-hidden className="size-3" data-icon="inline-start" role="presentation" />
      );
    default:
      return <CheckIcon data-icon="inline-start" />;
  }
}

export function KnowledgeStatusBadge({
  className,
  status,
}: {
  className?: string;
  status: KnowledgeSourceStatus;
}) {
  const { className: tone, label } = STATUS[status];
  return (
    <Badge className={cn("h-6 gap-1.5 px-2.5", tone, className)} variant="secondary">
      <StatusIcon status={status} />
      {label}
    </Badge>
  );
}
