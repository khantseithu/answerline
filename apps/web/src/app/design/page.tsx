import { BookOpenIcon, PhoneIcon, PlusIcon, Settings2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/brand/logo";
import {
  CALL_STATUSES,
  type CallStatus,
  CallStatusBadge,
} from "@/components/call/call-status-badge";
import { LiveDot } from "@/components/call/live-dot";
import { ColorTable, type ColorToken } from "@/components/design/color-table";
import {
  DialogDemo,
  MotionDemo,
  SelectDemo,
  ToastDemo,
  VisualizerDemo,
} from "@/components/design/demos";
import { GuideSection, Specimen, Surface } from "@/components/design/section";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Design system" };

const SECTIONS = [
  { id: "brand", title: "Brand" },
  { id: "color", title: "Color" },
  { id: "type", title: "Typography" },
  { id: "shape", title: "Space and shape" },
  { id: "motion", title: "Motion" },
  { id: "components", title: "Components" },
];

const SURFACE_TOKENS: ColorToken[] = [
  { name: "background", usage: "Page canvas" },
  { name: "card", usage: "Cards, tables, raised panels" },
  { name: "popover", usage: "Menus, dialogs, toasts" },
  { name: "muted", usage: "Empty states, quiet fills" },
  { name: "accent", usage: "Hover and selected rows in menus" },
  { name: "sidebar", usage: "Navigation layer behind the content" },
];

const CONTENT_TOKENS: ColorToken[] = [
  { name: "foreground", usage: "Body text and icons" },
  { name: "muted-foreground", usage: "Secondary text, captions (AA on muted)" },
  { name: "border", usage: "Dividers and card edges" },
  { name: "input", usage: "Form control borders (3:1 against the canvas)" },
];

const BRAND_TOKENS: ColorToken[] = [
  { name: "primary", usage: "Primary actions, current page, links" },
  { name: "live", usage: "The line is live: visualizer, live dot" },
  { name: "ring", usage: "Focus rings" },
];

const STATUS_TOKENS: ColorToken[] = [
  { name: "success", usage: "Completed calls, bookings" },
  { name: "warning", usage: "Missed calls, slow responses" },
  { name: "destructive", usage: "Failures, ending or removing things" },
  { name: "info", usage: "Transfers, neutral notices" },
];

const CHART_TOKENS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

const TYPE_SCALE = [
  {
    className: "font-semibold text-3xl tracking-tight",
    meta: "30/36 semibold, -0.025em",
    name: "Display",
    sample: "Every call, answered",
  },
  {
    className: "font-semibold text-2xl tracking-tight",
    meta: "24/32 semibold, -0.025em",
    name: "Page title",
    sample: "Recent calls",
  },
  {
    className: "font-semibold text-xl tracking-tight",
    meta: "20/28 semibold",
    name: "Section",
    sample: "Bright Smile Dental",
  },
  { className: "font-medium text-base", meta: "16/24 medium", name: "Heading", sample: "Today" },
  {
    className: "text-sm/relaxed",
    meta: "14/22 regular",
    name: "Body",
    sample: "Call your receptionist from the browser and talk to it the way a caller would.",
  },
  {
    className: "text-muted-foreground text-xs",
    meta: "12/16 regular",
    name: "Caption",
    sample: "Uses your microphone",
  },
];

const DATA_SAMPLES = [
  { label: "Phone number", value: "+1 (555) 010-0142" },
  { label: "Duration", value: "03:42" },
  { label: "Cost", value: "$0.084" },
  { label: "Latency", value: "612 ms" },
  { label: "Call ID", value: "call_8f3k2q9d" },
];

const SPACING = [
  { px: 4, token: "1" },
  { px: 8, token: "2" },
  { px: 12, token: "3" },
  { px: 16, token: "4" },
  { px: 24, token: "6" },
  { px: 32, token: "8" },
  { px: 48, token: "12" },
  { px: 64, token: "16" },
];

const RADII = [
  { className: "rounded-sm", name: "sm", px: "4px", usage: "Inline code, tiny chips" },
  { className: "rounded-md", name: "md", px: "6px", usage: "Menu items, swatches" },
  { className: "rounded-lg", name: "lg", px: "8px", usage: "Buttons, inputs, selects" },
  { className: "rounded-xl", name: "xl", px: "12px", usage: "Cards, tables, dialogs" },
  { className: "rounded-2xl", name: "2xl", px: "16px", usage: "Icon tiles, large panels" },
  { className: "rounded-full", name: "full", px: "pill", usage: "Badges, call controls" },
];

const SHADOWS = [
  { className: "shadow-xs", name: "xs", usage: "Cards at rest" },
  { className: "shadow-sm", name: "sm", usage: "Featured panels" },
  { className: "shadow-md", name: "md", usage: "Menus, toasts" },
  { className: "shadow-lg", name: "lg", usage: "Dialogs" },
];

const MOTION = [
  { name: "--duration-fast", usage: "Hover, color, focus", value: "150ms" },
  { name: "--duration-base", usage: "Fades, menus, panels", value: "200ms" },
  { name: "--ease-out", usage: "Everything that enters", value: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { name: "--animate-live-pulse", usage: "Live dot only", value: "2s, infinite" },
];

const CALLS: {
  caller: string;
  cost: string;
  duration: string;
  id: string;
  latency: string;
  started: string;
  status: CallStatus;
}[] = [
  {
    caller: "+1 (555) 013-7720",
    cost: "$0.021",
    duration: "01:05",
    id: "call_2hq81mzx",
    latency: "548 ms",
    started: "09:31",
    status: "live",
  },
  {
    caller: "+1 (555) 010-0142",
    cost: "$0.084",
    duration: "03:42",
    id: "call_8f3k2q9d",
    latency: "612 ms",
    started: "09:14",
    status: "completed",
  },
  {
    caller: "Web visitor",
    cost: "$0.052",
    duration: "02:18",
    id: "call_5tw0c7ra",
    latency: "701 ms",
    started: "08:57",
    status: "transferred",
  },
  {
    caller: "+1 (555) 019-3381",
    cost: "$0.012",
    duration: "00:41",
    id: "call_9pb4e2kn",
    latency: "590 ms",
    started: "08:40",
    status: "voicemail",
  },
  {
    caller: "+1 (555) 016-2290",
    cost: "$0.000",
    duration: "00:00",
    id: "call_1xa6v3jd",
    latency: "—",
    started: "08:22",
    status: "missed",
  },
  {
    caller: "+1 (555) 014-8813",
    cost: "$0.003",
    duration: "00:07",
    id: "call_7mz0r5ty",
    latency: "—",
    started: "08:05",
    status: "failed",
  },
];

function BrandPanel({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      className={cn(
        theme,
        "flex min-h-44 flex-col justify-between gap-8 rounded-xl bg-background p-6 text-foreground ring-1 ring-foreground/8"
      )}
    >
      <span className="text-muted-foreground text-xs capitalize">{theme}</span>
      <Logo className="[&>svg]:h-10" />
    </div>
  );
}

export default function DesignPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-8">
          <Link
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <Logo />
          </Link>
          <span className="hidden text-muted-foreground text-sm sm:inline">Design system</span>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Link className={buttonVariants({ variant: "outline" })} href="/overview">
              Open dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-10 px-4 py-10 md:px-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  className="block rounded-lg px-3 py-2 text-muted-foreground text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  href={`#${section.id}`}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-col gap-20">
          <div className="flex max-w-2xl flex-col gap-3">
            <h1 className="font-semibold text-3xl tracking-tight">Design system</h1>
            <p className="text-base/relaxed text-muted-foreground">
              The tokens, type, and components behind Answerline. Calm enough for a front desk,
              precise enough for the people who run it. Everything here renders from the same tokens
              the app uses, in whichever theme you have on.
            </p>
          </div>

          <GuideSection
            description="Signal “a”: a lowercase a cut by a continuous voice line, paired with the outlined wordmark from the approved logo."
            id="brand"
            title="Brand"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <BrandPanel theme="light" />
              <BrandPanel theme="dark" />
            </div>
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
              <Surface className="flex items-end gap-5">
                <span className="flex size-16 items-center justify-center rounded-2xl bg-[#007563] text-[#f6fdfb]">
                  <LogoMark className="size-11" />
                </span>
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#007563] text-[#f6fdfb]">
                  <LogoMark className="size-5" />
                </span>
                <span className="flex size-4 items-center justify-center rounded-[4px] bg-[#007563] text-[#f6fdfb]">
                  <LogoMark className="size-3" />
                </span>
              </Surface>
              <Surface className="flex flex-col justify-center gap-2 text-sm/relaxed">
                <p>
                  The app icon is the mark on a deep teal tile, one fixed color so it reads in light
                  and dark browser tabs. Inside the product the mark takes{" "}
                  <code className="numeric text-xs">primary</code> in navigation and{" "}
                  <code className="numeric text-xs">live</code> wherever a call is happening.
                </p>
                <p className="text-muted-foreground">
                  Files: <code className="numeric text-xs">brand/logo-black.svg</code>,{" "}
                  <code className="numeric text-xs">logo-white.svg</code>,{" "}
                  <code className="numeric text-xs">mark-black.svg</code>, and{" "}
                  <code className="numeric text-xs">apps/web/src/app/icon.svg</code>.
                </p>
              </Surface>
            </div>
          </GuideSection>

          <GuideSection
            description="Teal-tinted neutrals with one signal color. Values are OKLCH, read live from the stylesheet, so this table can't drift from the code."
            id="color"
            title="Color"
          >
            <ColorTable title="Brand and state" tokens={BRAND_TOKENS} />
            <ColorTable title="Status" tokens={STATUS_TOKENS} />
            <ColorTable title="Surfaces" tokens={SURFACE_TOKENS} />
            <ColorTable title="Text and lines" tokens={CONTENT_TOKENS} />
            <Specimen title="Charts">
              <div className="grid grid-cols-5 gap-2">
                {CHART_TOKENS.map((token) => (
                  <div className="flex flex-col gap-1.5" key={token}>
                    <span className="h-12 rounded-lg" style={{ background: `var(--${token})` }} />
                    <code className="numeric text-muted-foreground text-xs">{token}</code>
                  </div>
                ))}
              </div>
            </Specimen>
          </GuideSection>

          <GuideSection
            description="Geist for everything people read, Geist Mono with tabular numerals for anything people compare: numbers, durations, costs, IDs."
            id="type"
            title="Typography"
          >
            <Surface className="flex flex-col divide-y p-0 sm:p-0">
              {TYPE_SCALE.map((step) => (
                <div
                  className="grid gap-2 px-5 py-5 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-baseline md:gap-6"
                  key={step.name}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">{step.name}</span>
                    <span className="numeric text-muted-foreground text-xs">{step.meta}</span>
                  </div>
                  <p className={step.className}>{step.sample}</p>
                </div>
              ))}
            </Surface>
            <Specimen title="Data, set in Geist Mono with tabular numerals">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-foreground/6 sm:grid-cols-3 lg:grid-cols-5">
                {DATA_SAMPLES.map((sample) => (
                  <div className="flex flex-col gap-1 bg-card p-4" key={sample.label}>
                    <dt className="text-muted-foreground text-xs">{sample.label}</dt>
                    <dd className="numeric text-sm">{sample.value}</dd>
                  </div>
                ))}
              </dl>
            </Specimen>
          </GuideSection>

          <GuideSection
            description="A 4px grid, soft corners, and light shadows. Surfaces separate by tint first, then by a hairline ring, rarely by a heavy border."
            id="shape"
            title="Space and shape"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="Spacing">
                <Surface className="flex flex-wrap items-end gap-x-5 gap-y-4">
                  {SPACING.map((step) => (
                    <div className="flex flex-col items-start gap-2" key={step.token}>
                      <span
                        className="rounded-[3px] bg-primary/70"
                        style={{ height: `${step.px}px`, width: `${step.px}px` }}
                      />
                      <span className="flex flex-col">
                        <code className="numeric text-xs">{step.px}px</code>
                        <code className="numeric text-muted-foreground text-xs">{step.token}</code>
                      </span>
                    </div>
                  ))}
                </Surface>
              </Specimen>
              <Specimen title="Radius">
                <Surface className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {RADII.map((radius) => (
                    <div className="flex flex-col gap-2" key={radius.name}>
                      <span
                        className={cn(
                          "h-14 border-2 border-primary/60 bg-primary/8",
                          radius.className
                        )}
                      />
                      <span className="flex flex-col">
                        <span className="text-sm">
                          {radius.name}{" "}
                          <span className="numeric text-muted-foreground text-xs">{radius.px}</span>
                        </span>
                        <span className="text-muted-foreground text-xs">{radius.usage}</span>
                      </span>
                    </div>
                  ))}
                </Surface>
              </Specimen>
            </div>
            <Specimen title="Elevation">
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/60 p-6 sm:grid-cols-4">
                {SHADOWS.map((shadow) => (
                  <div
                    className={cn(
                      "flex h-24 flex-col justify-end rounded-xl bg-card p-3",
                      shadow.className
                    )}
                    key={shadow.name}
                  >
                    <span className="numeric text-sm">shadow-{shadow.name}</span>
                    <span className="text-muted-foreground text-xs">{shadow.usage}</span>
                  </div>
                ))}
              </div>
            </Specimen>
          </GuideSection>

          <GuideSection
            description="Quick and quiet: 150 to 200ms, easing out, fades over flourishes. The call visualizer is the only thing allowed to be expressive. Reduced-motion settings turn the rest off."
            id="motion"
            title="Motion"
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <Surface className="flex flex-col divide-y p-0 sm:p-0">
                {MOTION.map((item) => (
                  <div
                    className="grid gap-1 px-5 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:px-6"
                    key={item.name}
                  >
                    <code className="numeric font-medium text-sm">{item.name}</code>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                      <span className="numeric text-xs">{item.value}</span>
                      <span className="text-muted-foreground text-xs">{item.usage}</span>
                    </span>
                  </div>
                ))}
              </Surface>
              <Surface className="flex flex-col gap-4">
                <span className="flex items-center gap-2 text-sm">
                  <LiveDot />
                  Live dot pulse
                </span>
                <MotionDemo />
              </Surface>
            </div>
          </GuideSection>

          <GuideSection
            description="shadcn/ui on Base UI, restyled by tokens alone. Each block shows the states people will actually see."
            id="components"
            title="Components"
          >
            <Specimen title="Buttons">
              <Surface className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Button>
                    <PhoneIcon data-icon="inline-start" />
                    Talk to agent
                  </Button>
                  <Button variant="secondary">Save draft</Button>
                  <Button variant="outline">
                    <PlusIcon data-icon="inline-start" />
                    Add source
                  </Button>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="destructive">End call</Button>
                  <Button variant="link">View transcript</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">Small</Button>
                  <Button>Default</Button>
                  <Button size="lg">Large</Button>
                  <Button aria-label="Settings" size="icon" variant="outline">
                    <Settings2Icon />
                  </Button>
                  <Button disabled>
                    <Spinner data-icon="inline-start" />
                    Connecting…
                  </Button>
                  <Button disabled variant="outline">
                    Disabled
                  </Button>
                  <Button className="border-ring ring-3 ring-ring/50" variant="outline">
                    Focused
                  </Button>
                </div>
              </Surface>
            </Specimen>

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="Form controls">
                <Surface className="flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="business-name">Business name</FieldLabel>
                    <Input defaultValue="Bright Smile Dental" id="business-name" />
                  </Field>
                  <Field data-invalid>
                    <FieldLabel htmlFor="transfer-number">Transfer number</FieldLabel>
                    <Input aria-invalid defaultValue="555-0100" id="transfer-number" />
                    <FieldError>
                      Use the full number with country code, like +1 555 555 0100.
                    </FieldError>
                  </Field>
                  <Field data-disabled>
                    <FieldLabel htmlFor="api-key">Provider key</FieldLabel>
                    <Input disabled id="api-key" placeholder="Set in .env" />
                  </Field>
                </Surface>
              </Specimen>
              <Specimen title="Selects and switches">
                <Surface className="flex flex-col gap-5">
                  <SelectDemo />
                  <Field orientation="horizontal">
                    <Switch defaultChecked id="record-calls" />
                    <FieldLabel htmlFor="record-calls">Record calls</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Switch id="after-hours" />
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel htmlFor="after-hours">Answer after hours</FieldLabel>
                      <FieldDescription>Otherwise callers go to voicemail.</FieldDescription>
                    </div>
                  </Field>
                </Surface>
              </Specimen>
            </div>

            <Specimen title="Badges">
              <Surface className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {CALL_STATUSES.map((status) => (
                    <CallStatusBadge key={status} status={status} />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge className="numeric" variant="outline">
                    v0.1.0
                  </Badge>
                </div>
              </Surface>
            </Specimen>

            <Specimen title="Call table">
              <div className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-foreground/6">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-10 pl-5 font-medium text-muted-foreground">
                        Caller
                      </TableHead>
                      <TableHead className="h-10 font-medium text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="h-10 font-medium text-muted-foreground">
                        Started
                      </TableHead>
                      <TableHead className="h-10 text-right font-medium text-muted-foreground">
                        Duration
                      </TableHead>
                      <TableHead className="h-10 text-right font-medium text-muted-foreground">
                        Cost
                      </TableHead>
                      <TableHead className="h-10 pr-5 text-right font-medium text-muted-foreground">
                        Latency
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {CALLS.map((call) => (
                      <TableRow className="h-12" key={call.id}>
                        <TableCell className="pl-5">
                          <span className="flex flex-col">
                            <span className={cn(call.caller.startsWith("+") && "numeric")}>
                              {call.caller}
                            </span>
                            <span className="numeric text-muted-foreground text-xs">{call.id}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <CallStatusBadge status={call.status} />
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {call.started}
                        </TableCell>
                        <TableCell className="numeric text-right">{call.duration}</TableCell>
                        <TableCell className="numeric text-right">{call.cost}</TableCell>
                        <TableCell className="numeric pr-5 text-right text-muted-foreground">
                          {call.latency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Specimen>

            <div className="grid gap-6 lg:grid-cols-2">
              <Specimen title="Cards">
                <Card className="shadow-xs ring-foreground/6 [--card-spacing:--spacing(5)]">
                  <CardHeader>
                    <CardTitle>Call summary</CardTitle>
                    <CardDescription className="numeric text-xs">call_8f3k2q9d</CardDescription>
                    <CardAction>
                      <CallStatusBadge status="completed" />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="text-sm/relaxed">
                    Dana asked about whitening and booked a cleaning for Tuesday at 2:30 PM. She
                    confirmed her insurance is Delta Dental.
                  </CardContent>
                  <CardFooter className="justify-between gap-4 bg-muted/60">
                    <span className="numeric flex gap-3 text-muted-foreground text-xs">
                      <span>03:42</span>
                      <span>$0.084</span>
                    </span>
                    <Button size="sm" variant="outline">
                      Open call
                    </Button>
                  </CardFooter>
                </Card>
              </Specimen>
              <Specimen title="Dialogs and toasts">
                <Surface className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs">
                      Confirm destructive actions
                    </span>
                    <div>
                      <DialogDemo />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs">Toasts</span>
                    <ToastDemo />
                  </div>
                </Surface>
              </Specimen>
            </div>

            <Specimen title="Empty state">
              <EmptyPanel
                description="Add PDFs, web pages, and question-and-answer pairs. During a call, the agent searches them to answer in your words."
                icon={BookOpenIcon}
                title="Teach your receptionist"
              >
                <Button>
                  <PlusIcon data-icon="inline-start" />
                  Add a source
                </Button>
              </EmptyPanel>
            </Specimen>

            <Specimen title="Call visualizer">
              <VisualizerDemo />
            </Specimen>
          </GuideSection>
        </main>
      </div>
    </div>
  );
}
