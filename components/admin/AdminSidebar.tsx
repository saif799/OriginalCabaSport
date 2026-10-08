"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ExternalLink,
  History,
  Home,
  Images,
  Layers,
  LayoutGrid,
  PackagePlus,
  Scale,
  Settings,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";

import LogoutButton from "@/components/LogoutButton";
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
} from "@/components/ui/sidebar";

type NavItem = { href: string; label: string; icon: typeof Home };
type NavGroup = { label: string; items: NavItem[] };

/** Home sits on its own above the groups — it is the dashboard root, not a section. */
const homeLink: NavItem = { href: "/admin", label: "Home", icon: Home };

/**
 * The admin route list. Every href must resolve to a real directory under
 * app/admin/(admin)/ — this is the only inventory of the dashboard's pages.
 *
 * "Arrivages" keeps its French label on purpose: it is the domain term in
 * CONTEXT.md, not an untranslated string.
 */
const navGroups: NavGroup[] = [
  {
    label: "Inventory",
    items: [
      { href: "/admin/products", label: "Products", icon: ShoppingBag },
      { href: "/admin/add-shoes", label: "Add Shoes", icon: PackagePlus },
      { href: "/admin/arrivals", label: "Arrivages", icon: Truck },
      { href: "/admin/history", label: "History", icon: History },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: Layers },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Borrowers",
    items: [
      { href: "/admin/borrowers", label: "Borrowers", icon: Users },
      { href: "/admin/rebalance", label: "Rebalance", icon: Scale },
    ],
  },
  {
    label: "Storefront",
    items: [
      { href: "/admin/collections", label: "Collections", icon: LayoutGrid },
      { href: "/admin/gallery", label: "Gallery", icon: Images },
    ],
  },
  {
    label: "System",
    items: [{ href: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

/**
 * A section stays lit for its own sub-routes — /admin/products/x/edit keeps
 * "Products" active — while /admin itself must match exactly or it would light
 * up on every page.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname() ?? "";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <span className="text-xs font-medium">OCS</span>
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">OCS Inventory</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Admin
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={homeLink.label}
                  isActive={isActive(pathname, homeLink.href)}
                >
                  <Link href={homeLink.href}>
                    <homeLink.icon />
                    <span>{homeLink.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ href, label, icon: Icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      asChild
                      tooltip={label}
                      isActive={isActive(pathname, href)}
                    >
                      <Link href={href}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* ADR-0001 §10 asked for this and it never shipped. "/" is
                unlocalised on purpose — proxy.ts sends it to the visitor's
                locale, same as the front door does. */}
            <SidebarMenuButton asChild tooltip="View public storefront">
              <a href="/" target="_blank" rel="noreferrer">
                <ExternalLink />
                <span>View storefront</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <LogoutButton className="w-full justify-start" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

export default AdminSidebar;
