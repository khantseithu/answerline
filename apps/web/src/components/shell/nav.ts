import {
  BookOpenIcon,
  Grid3x3Icon,
  HeadsetIcon,
  LayoutGridIcon,
  ListChecksIcon,
  type LucideIcon,
  PhoneIncomingIcon,
  Settings2Icon,
} from "lucide-react";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  title: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", icon: LayoutGridIcon, title: "Overview" },
  { href: "/calls", icon: PhoneIncomingIcon, title: "Calls" },
];

export const SETUP_NAV: NavItem[] = [
  { href: "/agents", icon: HeadsetIcon, title: "Agents" },
  { href: "/knowledge", icon: BookOpenIcon, title: "Knowledge" },
  { href: "/evals", icon: ListChecksIcon, title: "Evals" },
  { href: "/phone-numbers", icon: Grid3x3Icon, title: "Phone numbers" },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", icon: Settings2Icon, title: "Settings" };

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
