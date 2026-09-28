import Link from "next/link";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";

export function AccountHeader({ actor }: { actor: AuthenticatedActor }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <div>
          <p className="font-semibold text-slate-950">
            {actor.organizationName}
          </p>
          <p className="text-sm text-slate-500">{actor.name}</p>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link className="text-slate-700 hover:text-slate-950" href="/profile">
            Profile
          </Link>
          <form action="/api/auth/sign-out" method="post">
            <button
              className="cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
