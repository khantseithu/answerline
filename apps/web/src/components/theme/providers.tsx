"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const TOAST_OPTIONS = {
  classNames: {
    error: "[&_[data-icon]]:text-destructive",
    info: "[&_[data-icon]]:text-info",
    success: "[&_[data-icon]]:text-success",
    toast: "cn-toast",
    warning: "[&_[data-icon]]:text-warning",
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster toastOptions={TOAST_OPTIONS} />
      </MotionConfig>
    </ThemeProvider>
  );
}
