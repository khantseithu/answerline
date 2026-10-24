import { AlertCircleIcon, ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CallPlayback, type PlaybackTurn } from "@/components/calls/call-playback";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type CallDetail, getCallDetail } from "@/lib/calls/detail";
import { formatOffset, turnOffsetSeconds } from "@/lib/calls/playback";
import { getDashboardContext } from "@/lib/dashboard/context";

export const metadata: Metadata = { title: "Call detail" };

function displayDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function displayLabel(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "—";
}

function displayMs(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value)} ms`;
}

function displayCost(cost: string | null) {
  return cost === null ? "—" : `$${Number(cost).toFixed(6)}`;
}

function displayDuration(durationMs: number | null) {
  return durationMs === null ? "—" : formatOffset(durationMs / 1000);
}

function relativeOffset(at: Date, origin: Date) {
  return formatOffset((at.getTime() - origin.getTime()) / 1000);
}

function playbackTurns(call: CallDetail): PlaybackTurn[] {
  return call.turns.map((turn) => ({
    id: turn.id,
    interrupted: turn.interrupted,
    role: turn.role,
    seekSeconds: turnOffsetSeconds(turn.startedAt, call.recordingStartedAt),
    text: turn.text,
    timeLabel: relativeOffset(turn.startedAt, call.startedAt),
  }));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm capitalize">{children}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}

function PlaybackSection({ call }: { call: CallDetail }) {
  const turns = playbackTurns(call);
  let note: string | null = null;
  if (!call.hasRecording) {
    note = "No recording was saved for this call.";
  } else if (!call.recordingStartedAt) {
    note =
      "This recording has no recorded start time, so transcript lines cannot seek into the audio. The audio still plays.";
  }
  return (
    <Section
      description={
        call.hasRecording && call.recordingStartedAt
          ? "Click a line to jump to it in the recording. The current line is highlighted while playing."
          : undefined
      }
      title="Recording and transcript"
    >
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
      {turns.length === 0 ? (
        <Empty>No transcript was captured for this call.</Empty>
      ) : (
        <CallPlayback
          audioSrc={call.hasRecording ? `/api/v1/calls/${call.id}/recording` : null}
          turns={turns}
        />
      )}
    </Section>
  );
}

export default async function CallDetailPage({ params }: PageProps<"/calls/[id]">) {
  const { id } = await params;
  let call: CallDetail | null;
  try {
    const { db, tenantId } = await getDashboardContext();
    call = await getCallDetail(db, tenantId, id);
  } catch {
    return (
      <PageContainer>
        <Link className={buttonVariants({ variant: "outline" })} href="/calls">
          <ArrowLeftIcon />
          Back to calls
        </Link>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Call is temporarily unavailable</AlertTitle>
          <AlertDescription>Try again in a moment.</AlertDescription>
        </Alert>
      </PageContainer>
    );
  }
  if (!call) {
    notFound();
  }

  const latencyTurns = call.turns.filter((turn) => turn.latency);
  const costLines = call.costBreakdown ?? [];
  const costUnknown = call.costUsd === null && costLines.length > 0;

  return (
    <PageContainer>
      <Link className={buttonVariants({ className: "w-fit", variant: "outline" })} href="/calls">
        <ArrowLeftIcon />
        Back to calls
      </Link>
      <PageHeader
        description={`${call.agentName} · ${call.channel === "sip" ? "Phone" : "Web"} · ${displayDate(call.startedAt)} UTC`}
        title="Call detail"
      />

      <Section title="Overview">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">{displayLabel(call.status)}</Field>
          <Field label="Outcome">{displayLabel(call.outcome)}</Field>
          <Field label="Sentiment">{displayLabel(call.sentiment)}</Field>
          <Field label="Duration">
            <span className="numeric">{displayDuration(call.durationMs)}</span>
          </Field>
          <Field label="Caller">{call.fromNumber ?? "Unknown"}</Field>
          <Field label="Dialed">{call.toNumber ?? "—"}</Field>
          <Field label="Direction">{displayLabel(call.direction)}</Field>
          <Field label="Total cost">
            <span className="numeric">{displayCost(call.costUsd)}</span>
          </Field>
        </dl>
        {call.summary ? (
          <p className="text-sm/relaxed">{call.summary}</p>
        ) : (
          <Empty>No summary yet. Post-call analysis has not produced one for this call.</Empty>
        )}
      </Section>

      <PlaybackSection call={call} />

      <Section
        description="Tool calls in the order the agent made them, with offsets from the start of the call."
        title="Tool calls"
      >
        {call.toolCalls.length === 0 ? (
          <Empty>No tool calls were made during this call.</Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {call.toolCalls.map((tool) => (
              <li className="flex flex-col gap-2 rounded-lg border p-4" key={tool.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium font-mono text-sm">{tool.name}</span>
                  <Badge variant={tool.status === "ok" ? "secondary" : "destructive"}>
                    {tool.status}
                  </Badge>
                  <span className="numeric text-muted-foreground text-xs">
                    {relativeOffset(tool.createdAt, call.startedAt)} · {displayMs(tool.latencyMs)}
                  </span>
                </div>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
                {tool.error ? <p className="text-destructive text-sm">{tool.error}</p> : null}
                {!tool.error && tool.result !== null ? (
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(tool.result, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        description="STT is the caller's speech-to-text delay. LLM TTFT is time to first token and TTS TTFB is time to first audio byte on agent turns."
        title="Latency per turn"
      >
        {latencyTurns.length === 0 ? (
          <Empty>No latency was recorded for this call.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offset</TableHead>
                  <TableHead>Speaker</TableHead>
                  <TableHead className="text-right">STT</TableHead>
                  <TableHead className="text-right">LLM TTFT</TableHead>
                  <TableHead className="text-right">TTS TTFB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latencyTurns.map((turn) => (
                  <TableRow key={turn.id}>
                    <TableCell className="numeric">
                      {relativeOffset(turn.startedAt, call.startedAt)}
                    </TableCell>
                    <TableCell className="capitalize">{turn.role}</TableCell>
                    <TableCell className="numeric text-right">
                      {displayMs(turn.latency?.sttMs)}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {displayMs(turn.latency?.llmTtftMs)}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {displayMs(turn.latency?.ttsTtfbMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section
        description="Estimated from configured unit prices. Provider invoices can differ."
        title="Cost breakdown"
      >
        {costLines.length === 0 ? (
          <Empty>No metered usage was recorded for this call.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Provider / model</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costLines.map((line) => (
                  <TableRow key={`${line.stage}-${line.provider}-${line.model}-${line.unit}`}>
                    <TableCell className="uppercase">{line.stage}</TableCell>
                    <TableCell>
                      {line.provider} / {line.model}
                    </TableCell>
                    <TableCell>{displayLabel(line.unit)}</TableCell>
                    <TableCell className="numeric text-right">
                      {line.quantity.toLocaleString("en")}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {line.unitPriceUsd === null ? "Unknown rate" : `$${line.unitPriceUsd}`}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {line.costUsd === null ? "—" : `$${line.costUsd.toFixed(6)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>
                    {costUnknown ? "Total unknown: some usage has no known rate" : "Total"}
                  </TableCell>
                  <TableCell className="numeric text-right">{displayCost(call.costUsd)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Section>
    </PageContainer>
  );
}
