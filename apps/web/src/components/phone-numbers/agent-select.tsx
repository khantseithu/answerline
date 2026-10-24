"use client";

import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentOption } from "@/lib/phone-numbers/types";

export function AgentSelect({
  agents,
  disabled,
  id,
  label,
  onChange,
  size,
  value,
}: {
  agents: AgentOption[];
  disabled?: boolean;
  id?: string;
  label: string;
  onChange: (slug: string) => void;
  size?: "sm" | "default";
  value: string | null;
}) {
  const options =
    value && !agents.some((agent) => agent.slug === value)
      ? [...agents, { name: value, slug: value }]
      : agents;
  const items = options.map((agent) => ({ label: agent.name, value: agent.slug }));

  const handleChange = useCallback(
    (next: string | null) => {
      if (next) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Select disabled={disabled} items={items} onValueChange={handleChange} value={value}>
      <SelectTrigger aria-label={label} className="w-56" id={id} size={size}>
        <SelectValue placeholder="Choose an agent" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
