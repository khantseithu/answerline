import { Grid3x3Icon, PhoneIncomingIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CallWelcome } from "@/components/call/call-welcome";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const METRICS = [
  { label: "Calls today", span: "col-span-2 sm:col-span-3 lg:col-span-1" },
  { label: "Avg duration", span: "sm:col-span-3 lg:col-span-1" },
  { label: "Cost", span: "sm:col-span-2 lg:col-span-1" },
  { label: "Bookings", span: "sm:col-span-2 lg:col-span-1" },
  { label: "Failure rate", span: "sm:col-span-2 lg:col-span-1" },
];

export const instant = false;

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <PageContainer>
      <PageHeader
        description="Your receptionist at a glance: who called, what they needed, and what it cost."
        title="Overview"
      />
      <CallWelcome />
      <section aria-labelledby="today-title" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-base" id="today-title">
            Today
          </h2>
          <p className="text-muted-foreground text-xs">Fills in once calls are logged</p>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/70 shadow-xs ring-1 ring-foreground/6 sm:grid-cols-6 lg:grid-cols-5">
          {METRICS.map((metric) => (
            <div
              className={cn("flex flex-col gap-1.5 bg-card p-5", metric.span)}
              key={metric.label}
            >
              <dt className="text-muted-foreground text-sm">{metric.label}</dt>
              <dd className="numeric text-2xl text-muted-foreground/50">—</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="recent-title" className="flex flex-col gap-3">
        <h2 className="font-medium text-base" id="recent-title">
          Recent calls
        </h2>
        <EmptyPanel
          description="Every phone and browser call lands here with its transcript, duration, and cost. Make a test call, or connect a number to start answering real callers."
          icon={PhoneIncomingIcon}
          title="No calls yet"
        >
          <Link className={buttonVariants({ variant: "outline" })} href="/phone-numbers">
            <Grid3x3Icon data-icon="inline-start" />
            Connect a phone number
          </Link>
        </EmptyPanel>
      </section>
    </PageContainer>
  );
}
