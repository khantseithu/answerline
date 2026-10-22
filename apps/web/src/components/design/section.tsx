import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GuideSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-6" id={id}>
      <div className="flex max-w-2xl flex-col gap-1.5">
        <h2 className="font-semibold text-xl tracking-tight" id={`${id}-title`}>
          {title}
        </h2>
        <p className="text-muted-foreground text-sm/relaxed">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function Specimen({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <h3 className="font-medium text-muted-foreground text-sm">{title}</h3>
      {children}
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("rounded-xl bg-card p-5 shadow-xs ring-1 ring-foreground/6 sm:p-6", className)}
    >
      {children}
    </div>
  );
}
