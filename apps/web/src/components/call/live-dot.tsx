import { cn } from "@/lib/utils";

export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 animate-live-pulse rounded-full bg-live", className)}
    />
  );
}
