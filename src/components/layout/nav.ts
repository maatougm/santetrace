import type { IconName } from "@/components/ui";

export interface ShellNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Active only on an exact path match (otherwise prefix match). */
  exact?: boolean;
  /** Grouped subpages that keep their own URL but highlight this item (prefix match). */
  matches?: readonly string[];
}

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavActive(pathname: string, item: ShellNavItem): boolean {
  if (item.matches?.some((href) => isUnder(pathname, href))) return true;
  if (item.exact) return pathname === item.href;
  return isUnder(pathname, item.href);
}
