import { CheckIcon, CircleAlertIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { EvalRunStatus } from "@/lib/evals/types";
import { cn } from "@/lib/utils";

const STATUS: Record<EvalRunStatus, { className: string; label: string }> = {
  completed: { className: "bg-success/12 text-success", label: "Completed" },
  failed: { className: "bg-destructive/12 text-destructive", label: "Failed" },
  queued: { className: "bg-muted text-muted-foreground", label: "Queued" },
  running: { className: "bg-info/12 text-info", label: "Running" },
};

function StatusIcon({ status }: { status: EvalRunStatus }) {
  switch (status) {
    case "failed":
      return <CircleAlertIcon data-icon="inline-start" />;
    case "queued":
      return <ClockIcon data-icon="inline-start" />;
    case "running":
      return (
        <Spinner aria-hidden className="size-3" data-icon="inline-start" role="presentation" />
      );
    default:
      return <CheckIcon data-icon="inline-start" />;
  }
}

export function EvalStatusBadge({
  className,
  status,
}: {
  className?: string;
  status: EvalRunStatus;
}) {
  const { className: tone, label } = STATUS[status];
  return (
    <Badge className={cn("h-6 gap-1.5 px-2.5", tone, className)} variant="secondary">
      <StatusIcon status={status} />
      {label}
    </Badge>
  );
}
