import {
  CheckIcon,
  CircleAlertIcon,
  type LucideIcon,
  PhoneForwardedIcon,
  PhoneMissedIcon,
  VoicemailIcon,
} from "lucide-react";
import { LiveDot } from "@/components/call/live-dot";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type CallStatus = "live" | "completed" | "transferred" | "voicemail" | "missed" | "failed";

const STATUS: Record<CallStatus, { className: string; icon?: LucideIcon; label: string }> = {
  completed: { className: "bg-success/12 text-success", icon: CheckIcon, label: "Completed" },
  failed: {
    className: "bg-destructive/12 text-destructive",
    icon: CircleAlertIcon,
    label: "Failed",
  },
  live: { className: "bg-live/15 text-foreground", label: "Live" },
  missed: { className: "bg-warning/14 text-warning", icon: PhoneMissedIcon, label: "Missed" },
  transferred: {
    className: "bg-info/12 text-info",
    icon: PhoneForwardedIcon,
    label: "Transferred",
  },
  voicemail: {
    className: "bg-muted text-muted-foreground",
    icon: VoicemailIcon,
    label: "Voicemail",
  },
};

export const CALL_STATUSES: CallStatus[] = [
  "live",
  "completed",
  "transferred",
  "voicemail",
  "missed",
  "failed",
];

export function CallStatusBadge({ status, className }: { status: CallStatus; className?: string }) {
  const { className: tone, icon: Icon, label } = STATUS[status];

  return (
    <Badge className={cn("h-6 gap-1.5 px-2.5", tone, className)} variant="secondary">
      {Icon ? <Icon data-icon="inline-start" /> : <LiveDot className="size-1.5" />}
      {label}
    </Badge>
  );
}
