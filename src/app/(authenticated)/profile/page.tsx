import type { Metadata } from "next";
import Link from "next/link";

import { getRoleHome } from "@/modules/auth/domain/application-role";
import { requireAuthenticatedPageUser } from "@/modules/auth/infrastructure/auth-guard";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const actor = await requireAuthenticatedPageUser();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between gap-6">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Profile
          </h1>
          <Link
            className="text-sm font-medium text-slate-600 hover:text-slate-950"
            href={getRoleHome(actor.role)}
          >
            Back to dashboard
          </Link>
        </div>
        <dl className="mt-8 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-slate-500">Name</dt>
            <dd className="mt-1 text-slate-950">{actor.name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Email</dt>
            <dd className="mt-1 text-slate-950">{actor.email}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Organization</dt>
            <dd className="mt-1 text-slate-950">{actor.organizationName}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Role</dt>
            <dd className="mt-1 text-slate-950">{actor.role}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
