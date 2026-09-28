import Link from "next/link";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { Badge } from "@/shared/ui/badge";
import { BrandMark } from "@/shared/ui/brand-mark";
import { Navigation, type NavigationItem } from "@/shared/ui/navigation";

function UserInitials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-bold text-teal-700 ring-1 ring-teal-600/20">
      {initials || "U"}
    </span>
  );
}

export function ApplicationShell({
  actor,
  children,
  homeHref,
  navigation,
  portalLabel,
}: {
  actor: AuthenticatedActor;
  children: React.ReactNode;
  homeHref: string;
  navigation: ReadonlyArray<NavigationItem>;
  portalLabel: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <BrandMark />
          <div className="min-w-0">
            <Link
              className="block truncate text-sm font-bold tracking-tight text-slate-950"
              href={homeHref}
            >
              Employee Lending
            </Link>
            <p className="mt-0.5 text-xs text-slate-500">{portalLabel}</p>
          </div>
        </div>

        <div className="flex-1 px-4 py-6">
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Workspace
          </p>
          <Navigation items={navigation} />
        </div>

        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 rounded-xl bg-slate-50 p-3">
            <p className="truncate text-xs font-medium text-slate-500">
              Organization
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {actor.organizationName}
            </p>
          </div>
          <div className="flex items-center gap-3 px-1">
            <UserInitials name={actor.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {actor.name}
              </p>
              <p className="truncate text-xs text-slate-500">{actor.email}</p>
            </div>
          </div>
          <form action="/api/auth/sign-out" className="mt-3" method="post">
            <button
              className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <Link className="flex min-w-0 items-center gap-3" href={homeHref}>
              <BrandMark />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-950">
                  Employee Lending
                </p>
                <p className="text-xs text-slate-500">{portalLabel}</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Badge className="hidden sm:inline-flex" tone="accent">
                {actor.organizationName}
              </Badge>
              <UserInitials name={actor.name} />
            </div>
          </div>
          <div className="border-t border-slate-100 px-4 py-2 sm:px-6">
            <Navigation items={navigation} variant="mobile" />
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
