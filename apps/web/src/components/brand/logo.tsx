import { cn } from "@/lib/utils";

export const LOGO_MARK_PATH = "M2.5 12H5M8.5 8v8M12 4v16M15.5 6.5v11M19 12h2.5";

export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={2.25}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d={LOGO_MARK_PATH} />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("text-primary", markClassName)} />
      <span className="font-semibold text-[1.0625rem] leading-none tracking-[-0.03em]">
        answerline
      </span>
    </span>
  );
}
