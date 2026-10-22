"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const THEMES = [
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
  { icon: MonitorIcon, label: "System", value: "system" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label="Change theme" size="icon" variant="ghost" />}
      >
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup onValueChange={setTheme} value={theme ?? "system"}>
          {THEMES.map(({ icon: Icon, label, value }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const onValueChange = useCallback(
    ([next]: string[]) => {
      if (next) {
        setTheme(next);
      }
    },
    [setTheme]
  );

  return (
    <ToggleGroup
      aria-label="Theme"
      onValueChange={onValueChange}
      spacing={1}
      value={[theme ?? "system"]}
      variant="outline"
    >
      {THEMES.map(({ icon: Icon, label, value }) => (
        <ToggleGroupItem
          aria-label={label}
          className="px-3 aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
          key={value}
          value={value}
        >
          <Icon />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
