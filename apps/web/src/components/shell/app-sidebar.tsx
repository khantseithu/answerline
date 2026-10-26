"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, LogoMark } from "@/components/brand/logo";
import {
  isActive,
  type NavItem,
  PRIMARY_NAV,
  SETTINGS_NAV,
  SETUP_NAV,
} from "@/components/shell/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";
import type { WorkspaceView } from "@/lib/workspaces/types";

function NavMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu className="gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              className="h-9 gap-2.5 px-2.5 text-sidebar-foreground/80 data-active:text-sidebar-accent-foreground [&_svg]:text-sidebar-foreground/60 data-active:[&_svg]:text-sidebar-primary"
              isActive={active}
              render={
                <Link
                  aria-current={active ? "page" : undefined}
                  href={item.href}
                  onClick={isMobile ? () => setOpenMobile(false) : undefined}
                />
              }
              tooltip={item.title}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceView;
  workspaces: WorkspaceView[];
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-4 px-3 py-3 group-data-[collapsible=icon]:px-2">
        <Link
          aria-label="Answerline home"
          className="flex h-9 items-center rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          href="/"
        >
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <LogoMark className="hidden text-sidebar-primary group-data-[collapsible=icon]:block" />
        </Link>
        <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} />
      </SidebarHeader>
      <SidebarContent className="gap-1 px-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu items={PRIMARY_NAV} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Setup</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu items={SETUP_NAV} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-3 group-data-[collapsible=icon]:px-2">
        <NavMenu items={[SETTINGS_NAV]} pathname={pathname} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
