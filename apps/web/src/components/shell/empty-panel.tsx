import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const REPO_ISSUES = "https://github.com/khantseithu/answerline/issues";

export function EmptyPanel({
  icon: Icon,
  title,
  description,
  issue,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  issue?: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("gap-6 bg-muted/60 px-6 py-14 md:py-20", className)}>
      <EmptyHeader className="max-w-md gap-2.5">
        <EmptyMedia
          className="mb-1 size-11 rounded-xl bg-card text-primary shadow-xs ring-1 ring-foreground/6 [&_svg:not([class*='size-'])]:size-5"
          variant="icon"
        >
          <Icon />
        </EmptyMedia>
        <EmptyTitle className="font-semibold text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? (
        <EmptyContent className="flex-row flex-wrap justify-center">{children}</EmptyContent>
      ) : null}
      {issue ? (
        <p className="text-muted-foreground text-xs">
          Planned.{" "}
          <a
            className="rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href={`${REPO_ISSUES}/${issue}`}
            rel="noreferrer"
            target="_blank"
          >
            Follow progress in #{issue}
          </a>
        </p>
      ) : null}
    </Empty>
  );
}
