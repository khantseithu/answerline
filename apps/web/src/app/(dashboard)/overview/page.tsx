import { ArrowUpRightIcon, Grid3x3Icon, PhoneIncomingIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CallWelcome } from "@/components/call/call-welcome";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardContext } from "@/lib/dashboard/context";
import { getOverviewData } from "@/lib/overview/data";
import { cn } from "@/lib/utils";

export const instant = false;

export const metadata: Metadata = { title: "Overview" };

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "—";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  return `${hours}h ${minutes}m`;
}

function formatUsd(amount: string | number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(amount));
}

function formatUtcTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function metricDetails(data: Awaited<ReturnType<typeof getOverviewData>>) {
  let costValue = "Unpriced";
  let costDescription = `No known subtotal · ${data.unpricedCalls} unpriced calls`;
  if (data.callsToday === 0) {
    costValue = formatUsd(0);
    costDescription = "No calls today";
  } else {
    if (data.knownCostUsd !== null) {
      costValue = formatUsd(data.knownCostUsd);
    }
    if (data.unpricedCalls === 0) {
      costDescription = `All ${data.callsToday} calls priced`;
    } else if (data.knownCostUsd !== null) {
      costDescription = `Known subtotal · ${data.unpricedCalls} unpriced ${data.unpricedCalls === 1 ? "call" : "calls"}`;
    } else if (data.unpricedCalls === 1) {
      costDescription = "No known subtotal · 1 unpriced call";
    }
  }

  return [
    {
      description: "Started today",
      label: "Calls today",
      value: String(data.callsToday),
    },
    {
      description:
        data.averageDurationMs === null
          ? "No measured durations yet"
          : "Ended calls with measured duration",
      label: "Avg duration",
      value: formatDuration(data.averageDurationMs),
    },
    {
      description: costDescription,
      label: "Cost",
      value: costValue,
    },
    {
      description: "Confirmed, created today",
      label: "Bookings",
      value: String(data.bookingsToday),
    },
    {
      description:
        data.failureRate === null
          ? "No completed or failed calls yet"
          : `${data.failedCalls} failed of ${data.completedOrFailedCalls} ended calls`,
      label: "Failure rate",
      value: data.failureRate === null ? "—" : `${(data.failureRate * 100).toFixed(1)}%`,
    },
  ];
}

export default async function OverviewPage() {
  const { db, tenantId } = await getDashboardContext();
  const data = await getOverviewData(db, tenantId);

  return (
    <PageContainer>
      <PageHeader
        description="Calls, bookings, and cost from your receptionist today."
        title="Overview"
      />
      <CallWelcome />
      <section aria-labelledby="today-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-base" id="today-title">
            Today, UTC
          </h2>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {metricDetails(data).map((metric) => (
            <div
              className="flex min-h-32 flex-col justify-between gap-3 rounded-xl bg-card p-5 shadow-xs ring-1 ring-foreground/6"
              key={metric.label}
            >
              <dt className="text-muted-foreground text-sm">{metric.label}</dt>
              <dd className="numeric font-medium text-2xl tracking-tight">{metric.value}</dd>
              <dd className="text-muted-foreground text-xs">{metric.description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="recent-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-medium text-base" id="recent-title">
            Recent calls
          </h2>
          <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/calls">
            View call history
            <ArrowUpRightIcon data-icon="inline-end" />
          </Link>
        </div>
        {data.recentCalls.length === 0 ? (
          <EmptyPanel
            description="Your phone and browser calls will appear here after they start. Make a test call, or connect a number to start answering real callers."
            icon={PhoneIncomingIcon}
            title="No calls yet"
          >
            <Link className={buttonVariants({ variant: "outline" })} href="/phone-numbers">
              <Grid3x3Icon data-icon="inline-start" />
              Connect a phone number
            </Link>
          </EmptyPanel>
        ) : (
          <div className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead>
                  <TableHead>Started (UTC)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="pr-5 text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentCalls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className={cn("font-medium", call.fromNumber && "numeric")}>
                      {call.fromNumber ?? (call.channel === "web" ? "Browser call" : "Phone call")}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      <time dateTime={call.startedAt.toISOString()}>
                        {formatUtcTime(call.startedAt)}
                      </time>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          call.status === "completed" && "bg-success/12 text-success",
                          call.status === "failed" && "bg-destructive/12 text-destructive",
                          call.status === "in_progress" && "bg-live/15 text-foreground"
                        )}
                        variant="secondary"
                      >
                        {call.status === "in_progress" ? "In progress" : call.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatDuration(call.durationMs)}
                    </TableCell>
                    <TableCell className="numeric pr-5 text-right">
                      {call.costUsd === null ? "Unpriced" : formatUsd(call.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
