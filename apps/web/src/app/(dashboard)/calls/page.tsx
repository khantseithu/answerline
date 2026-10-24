import { AlertCircleIcon, PhoneIncomingIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseCallsQuery } from "@/lib/calls/query";
import { listCallFilters, listCalls } from "@/lib/calls/service";
import { getDashboardContext } from "@/lib/dashboard/context";
import { cn } from "@/lib/utils";

export const instant = false;
export const metadata: Metadata = { title: "Calls" };

type PageSearchParams = Record<string, string | string[] | undefined>;

function queryString(query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function displayDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function displayDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "—";
  }
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function displayCost(cost: string | null) {
  return cost === null ? "—" : `$${Number(cost).toFixed(6)}`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const parsed = parseCallsQuery(params);
  if (!parsed.success) {
    return (
      <PageContainer>
        <PageHeader description="Review calls answered by your receptionist." title="Calls" />
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Couldn’t load calls</AlertTitle>
          <AlertDescription>
            {parsed.error.issues[0]?.message ?? "Check the filters and try again."}
          </AlertDescription>
        </Alert>
        <Link className={buttonVariants({ variant: "outline" })} href="/calls">
          Clear filters
        </Link>
      </PageContainer>
    );
  }

  let loaded: {
    options: Awaited<ReturnType<typeof listCallFilters>>;
    result: Awaited<ReturnType<typeof listCalls>>;
  } | null = null;
  try {
    const { db, tenantId } = await getDashboardContext();
    const [result, options] = await Promise.all([
      listCalls(db, tenantId, parsed.data),
      listCallFilters(db, tenantId),
    ]);
    loaded = { options, result };
  } catch {
    return (
      <PageContainer>
        <PageHeader description="Review calls answered by your receptionist." title="Calls" />
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Calls are temporarily unavailable</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  if (!loaded) {
    return null;
  }
  const { options, result } = loaded;
  const query = parsed.data;
  const filters = {
    agentId: query.agentId,
    channel: query.channel,
    from: query.from,
    outcome: query.outcome,
    pageSize: String(query.pageSize),
    q: query.q,
    to: query.to,
  };
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hasFilters = Boolean(
    query.agentId || query.channel || query.from || query.to || query.outcome || query.q
  );
  const emptyState = hasFilters ? (
    <section className="rounded-xl border border-dashed px-6 py-12 text-center">
      <h2 className="font-medium">No calls match these filters</h2>
      <p className="mt-1 text-muted-foreground text-sm">
        Try changing your search or clearing the filters.
      </p>
      <Link className={cn(buttonVariants({ variant: "outline" }), "mt-4")} href="/calls">
        Clear filters
      </Link>
    </section>
  ) : (
    <EmptyPanel
      description="Phone and browser calls will appear here after they end."
      icon={PhoneIncomingIcon}
      title="No calls yet"
    />
  );

  return (
    <PageContainer>
      <PageHeader
        description="Search transcripts and review the agent, caller, outcome, duration, and cost for every call. Dates use UTC."
        title="Calls"
      />
      <form
        action="/calls"
        className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4"
        method="get"
      >
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-search">Search transcript</label>
          <Input
            defaultValue={query.q ?? ""}
            id="calls-search"
            name="q"
            placeholder="Search words or phrases"
            type="search"
          />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-agent">Agent</label>
          <NativeSelect defaultValue={query.agentId ?? ""} id="calls-agent" name="agentId">
            <NativeSelectOption value="">All agents</NativeSelectOption>
            {options.agents.map((agent) => (
              <NativeSelectOption key={agent.id} value={agent.id}>
                {agent.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-channel">Channel</label>
          <NativeSelect defaultValue={query.channel ?? ""} id="calls-channel" name="channel">
            <NativeSelectOption value="">All channels</NativeSelectOption>
            <NativeSelectOption value="web">Web</NativeSelectOption>
            <NativeSelectOption value="sip">Phone (SIP)</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-outcome">Outcome</label>
          <NativeSelect defaultValue={query.outcome ?? ""} id="calls-outcome" name="outcome">
            <NativeSelectOption value="">All outcomes</NativeSelectOption>
            {options.outcomes.map((outcome) => (
              <NativeSelectOption key={outcome} value={outcome}>
                {outcome.replaceAll("_", " ")}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-from">From (UTC)</label>
          <Input defaultValue={query.from ?? ""} id="calls-from" name="from" type="date" />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-to">To (UTC)</label>
          <Input defaultValue={query.to ?? ""} id="calls-to" name="to" type="date" />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="calls-page-size">Per page</label>
          <NativeSelect defaultValue={String(query.pageSize)} id="calls-page-size" name="pageSize">
            {[25, 50, 100].map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Apply filters</Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/calls">
            Clear
          </Link>
        </div>
      </form>

      {result.total === 0 ? (
        emptyState
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <p>
              {result.total} {result.total === 1 ? "call" : "calls"}
            </p>
            <p>
              Page {result.page} of {pageCount}
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started (UTC)</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Caller</TableHead>
                  <TableHead>Status / outcome</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link className="hover:underline" href={`/calls/${call.id}`}>
                        {displayDate(call.startedAt)}
                      </Link>
                    </TableCell>
                    <TableCell>{call.channel === "sip" ? "Phone" : "Web"}</TableCell>
                    <TableCell>{call.agentName}</TableCell>
                    <TableCell>{call.caller ?? "Unknown"}</TableCell>
                    <TableCell className="capitalize">
                      {call.outcome?.replaceAll("_", " ") ?? call.status.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="numeric">{displayDuration(call.durationMs)}</TableCell>
                    <TableCell className="numeric text-right">
                      {displayCost(call.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Call pages" className="flex items-center justify-end gap-2">
            {query.page > 1 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/calls?${queryString({ ...filters, page: String(query.page - 1) })}`}
              >
                Previous
              </Link>
            ) : null}
            {query.page < pageCount ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/calls?${queryString({ ...filters, page: String(query.page + 1) })}`}
              >
                Next
              </Link>
            ) : null}
          </nav>
        </section>
      )}
    </PageContainer>
  );
}
