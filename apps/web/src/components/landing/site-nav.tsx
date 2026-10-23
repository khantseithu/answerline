"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { GitHubIcon } from "@/components/brand/github-icon";
import { Logo } from "@/components/brand/logo";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#stack", label: "Architecture" },
  { href: "/overview", label: "Dashboard" },
];

export function SiteNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((open) => !open);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-border/70 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            aria-label="Answerline home"
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <Logo />
          </Link>
          <nav aria-label="Main navigation" className="hidden md:flex md:items-center md:gap-6">
            {NAV_LINKS.map((item) => (
              <a
                className="font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-2.5 sm:flex">
          <ThemeToggle />
          <a
            aria-label="Answerline on GitHub"
            className={buttonVariants({ size: "icon", variant: "ghost" })}
            href="https://github.com/khantseithu/answerline"
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            <span className="sr-only">GitHub</span>
          </a>
          <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/overview">
            Dashboard
          </Link>
          <TalkToAgentButton className="h-8 px-3 text-xs" size="sm" />
        </div>

        <div className="flex items-center gap-2 sm:hidden">
          <ThemeToggle />
          <Button
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            onClick={toggleMobileMenu}
            size="icon"
            variant="ghost"
          >
            {mobileMenuOpen ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </Button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="border-border border-b bg-background px-4 pt-3 pb-5 sm:hidden">
          <nav aria-label="Mobile navigation" className="flex flex-col gap-3">
            {NAV_LINKS.map((item) => (
              <a
                className="font-medium text-foreground text-sm"
                href={item.href}
                key={item.href}
                onClick={closeMobileMenu}
              >
                {item.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-border/70 border-t pt-3">
              <Link
                className={cn(buttonVariants({ variant: "outline" }), "w-full justify-center")}
                href="/overview"
                onClick={closeMobileMenu}
              >
                Open dashboard
              </Link>
              <TalkToAgentButton className="w-full justify-center" />
              <a
                className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-center gap-2")}
                href="https://github.com/khantseithu/answerline"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitHubIcon />
                View on GitHub
              </a>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
