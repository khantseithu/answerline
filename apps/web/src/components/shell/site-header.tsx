import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { TalkToAgentButton } from "@/components/call/talk-to-agent-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-t-xl bg-background px-3 md:px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
      <Link
        aria-label="Answerline home"
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        href="/"
      >
        <LogoMark className="text-primary" />
      </Link>
      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <TalkToAgentButton className="h-9 px-3" />
      </div>
    </header>
  );
}
