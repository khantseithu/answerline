import { LOGO_MARK_PATH, LOGO_WORDMARK_PATH } from "@/components/brand/logo-paths";
import { cn } from "@/lib/utils";

export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      fill="currentColor"
      viewBox="-4 -4 256 256"
      {...props}
    >
      <path d={LOGO_MARK_PATH} />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <svg
        aria-label="answerline"
        className="h-6 w-auto shrink-0"
        fill="currentColor"
        role="img"
        viewBox="-4 -4 1352 256"
      >
        <title>answerline</title>
        <path className={markClassName} d={LOGO_MARK_PATH} />
        <path d={LOGO_WORDMARK_PATH} />
      </svg>
    </span>
  );
}
