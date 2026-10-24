export type NavLink = { href: string; label: string };

export const DASHBOARD_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
];
