"use client";

import { useEffect, useRef, useState } from "react";
import { labToOklch } from "@/lib/color";
import { cn } from "@/lib/utils";

export function TokenValue({ token, className }: { token: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (ref.current) {
      setValue(labToOklch(getComputedStyle(ref.current).getPropertyValue(token)));
    }
  }, [token]);

  return (
    <span className={cn("numeric text-muted-foreground text-xs", className)} ref={ref}>
      {value || " "}
    </span>
  );
}
