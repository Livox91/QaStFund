"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/utils/class-names";

export type NavigationIcon =
  | "dashboard"
  | "employees"
  | "integrations"
  | "loans"
  | "marketplace"
  | "policies"
  | "profile"
  | "reports"
  | "settings";

export type NavigationItem = Readonly<{
  href: string;
  icon: NavigationIcon;
  label: string;
  exact?: boolean;
  group?: string;
}>;

function NavigationItemIcon({ icon }: { icon: NavigationIcon }) {
  const paths: Record<NavigationIcon, React.ReactNode> = {
    dashboard: (
      <path d="M4.75 4.75h5.5v5.5h-5.5v-5.5Zm9 0h5.5v5.5h-5.5v-5.5Zm-9 9h5.5v5.5h-5.5v-5.5Zm9 0h5.5v5.5h-5.5v-5.5Z" />
    ),
    employees: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14.5a5.5 5.5 0 0 1 3.5 5.5" />
      </>
    ),
    integrations: (
      <path d="M8 8V5m8 3V5M6 8h12v3a6 6 0 0 1-6 6v0a6 6 0 0 1-6-6V8Zm6 9v4" />
    ),
    loans: (
      <>
        <path d="M4 7.5h16v11H4zM7 7.5v-2h10v2" />
        <path d="M8 13h8M12 10v6" />
      </>
    ),
    marketplace: (
      <>
        <path d="M4 9h16l-1-5H5L4 9Z" />
        <path d="M5 9v11h14V9M9 20v-6h6v6M3 9a3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 5 0 3 3 0 0 0 3-3" />
      </>
    ),
    policies: (
      <>
        <path d="M7 3h7l4 4v14H7zM14 3v5h5" />
        <path d="M10 12h5m-5 4h5" />
      </>
    ),
    profile: (
      <path d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.1a7.5 7.5 0 0 1 15 0 17.9 17.9 0 0 1-7.5 1.65A17.9 17.9 0 0 1 4.5 20.1Z" />
    ),
    reports: (
      <>
        <path d="M5 20V10m7 10V4m7 16v-7" />
        <path d="M3 20h18" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19 13.5v-3l-2-.7a7 7 0 0 0-.8-1.8l.9-1.9-2.2-2.2-1.9.9a7 7 0 0 0-1.8-.8L10.5 2h-3l-.7 2a7 7 0 0 0-1.8.8l-1.9-.9L.9 6.1 1.8 8a7 7 0 0 0-.8 1.8l-2 .7v3l2 .7a7 7 0 0 0 .8 1.8l-.9 1.9 2.2 2.2 1.9-.9a7 7 0 0 0 1.8.8l.7 2h3l.7-2a7 7 0 0 0 1.8-.8l1.9.9 2.2-2.2-.9-1.9a7 7 0 0 0 .8-1.8l2-.7Z"
          transform="translate(3) scale(.75 1)"
        />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[icon]}
    </svg>
  );
}

function isActivePath(pathname: string, item: NavigationItem) {
  return (
    pathname === item.href ||
    (!item.exact && item.href !== "/" && pathname.startsWith(`${item.href}/`))
  );
}

export function Navigation({
  items,
  variant = "sidebar",
}: {
  items: ReadonlyArray<NavigationItem>;
  variant?: "sidebar" | "mobile";
}) {
  const pathname = usePathname();

  const links = (entries: ReadonlyArray<NavigationItem>) =>
    entries.map((item) => {
      const active = isActivePath(pathname, item);

      return (
        <Link
          key={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "focus-visible:outline-accent flex min-h-10 items-center gap-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
            variant === "sidebar" ? "px-3 py-2.5" : "px-3 py-2",
            active
              ? "bg-brand !text-white shadow-sm"
              : "hover:bg-brand-soft hover:text-brand text-slate-600",
          )}
          href={item.href}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
          }}
        >
          <NavigationItemIcon icon={item.icon} />
          {item.label}
        </Link>
      );
    });

  if (variant === "mobile") {
    const current = items.find((item) => isActivePath(pathname, item));
    return (
      <nav aria-label="Portal navigation">
        <details className="group relative">
          <summary className="focus-visible:outline-accent flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <span>Menu</span>
              <span className="text-slate-300">/</span>
              <span className="truncate text-slate-500">
                {current?.label ?? "Navigate"}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="text-lg transition-transform group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>
          <div className="bg-surface absolute top-[calc(100%+0.5rem)] right-0 left-0 z-30 grid max-h-[min(70dvh,32rem)] gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 shadow-xl sm:grid-cols-2">
            {links(items)}
          </div>
        </details>
      </nav>
    );
  }

  const groups = new Map<string, NavigationItem[]>();
  for (const item of items) {
    const group = item.group ?? "Workspace";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }

  return (
    <nav aria-label="Portal navigation" className="space-y-6">
      {[...groups].map(([group, entries]) => (
        <div key={group}>
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            {group}
          </p>
          <div className="space-y-1">{links(entries)}</div>
        </div>
      ))}
    </nav>
  );
}
