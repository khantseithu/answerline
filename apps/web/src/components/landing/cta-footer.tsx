import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { GitHubIcon } from "@/components/brand/github-icon";
import { Logo } from "@/components/brand/logo";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

const FOOTER_LINKS = {
  navigation: [
    { href: "/overview", label: "Overview" },
    { href: "/calls", label: "Calls" },
    { href: "/agents", label: "Agents" },
    { href: "/knowledge", label: "Knowledge" },
    { href: "/evals", label: "Evals" },
    { href: "/phone-numbers", label: "Phone numbers" },
    { href: "/settings", label: "Settings" },
  ],
  product: [
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How it works" },
    { href: "#stack", label: "Architecture" },
    { href: "/design", label: "Design system" },
  ],
  resources: [
    { href: "https://github.com/khantseithu/answerline", label: "GitHub Repository" },
    {
      href: "https://github.com/khantseithu/answerline/blob/main/docs/architecture.md",
      label: "Architecture Doc",
    },
    { href: "https://github.com/khantseithu/answerline/issues", label: "Roadmap Issues" },
    { href: "https://github.com/khantseithu/answerline/blob/main/LICENSE", label: "MIT License" },
  ],
};

export function CtaFooter() {
  return (
    <footer className="border-border/70 border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mb-16 flex flex-col gap-8 rounded-2xl border border-border/80 bg-muted/40 p-8 sm:p-12 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <h2 className="font-semibold text-2xl text-foreground tracking-tight sm:text-3xl">
              Deploy your AI receptionist on your own terms
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base/relaxed">
              Clone the repository, bring your own API keys, and run your first browser test call in
              five minutes.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <TalkToAgentButton className="h-10 px-4 text-sm" size="lg" />
            <Link className={buttonVariants({ size: "lg", variant: "outline" })} href="/overview">
              Open dashboard
              <ArrowRightIcon className="size-4" />
            </Link>
            <a
              className={buttonVariants({ size: "lg", variant: "ghost" })}
              href="https://github.com/khantseithu/answerline"
              rel="noopener noreferrer"
              target="_blank"
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
          <div className="col-span-2 flex flex-col gap-4 md:col-span-1">
            <Link
              aria-label="Answerline home"
              className="w-fit rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="/"
            >
              <Logo />
            </Link>
            <p className="max-w-xs text-muted-foreground text-xs/relaxed">
              An open-source, self-hosted AI voice receptionist. Answers phone and web calls, books
              appointments, and logs every turn to your own Postgres.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Product
            </span>
            <ul className="flex flex-col gap-2 text-xs">
              {FOOTER_LINKS.product.map((link) => (
                <li key={link.label}>
                  <a
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    href={link.href}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Dashboard
            </span>
            <ul className="flex flex-col gap-2 text-xs">
              {FOOTER_LINKS.navigation.map((link) => (
                <li key={link.label}>
                  <Link
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    href={link.href}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
              Open Source
            </span>
            <ul className="flex flex-col gap-2 text-xs">
              {FOOTER_LINKS.resources.map((link) => (
                <li key={link.label}>
                  <a
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    href={link.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-border/70 border-t pt-8 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            Answerline is open-source software licensed under MIT. Call data and model keys stay on
            your infrastructure.
          </p>
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
