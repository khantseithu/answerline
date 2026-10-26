"use client";

import { type WorkspaceRole, workspaceRoleSchema } from "@answerline/shared";
import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const items = [
  { label: "Owner", value: "owner" },
  { label: "Admin", value: "admin" },
  { label: "Viewer", value: "viewer" },
];

export function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  label: string;
  disabled?: boolean;
}) {
  const handleChange = useCallback(
    (next: string | null) => {
      if (next) {
        onChange(workspaceRoleSchema.parse(next));
      }
    },
    [onChange]
  );
  return (
    <Select disabled={disabled} items={items} onValueChange={handleChange} value={value}>
      <SelectTrigger aria-label={label} className="w-28">
        <SelectValue />
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
