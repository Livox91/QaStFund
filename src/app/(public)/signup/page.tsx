import type { Metadata } from "next";
import Link from "next/link";

import { ProductBrand } from "@/shared/ui/brand-mark";

import { EmployerSignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create employer account",
  description: "Create an organization and connect its ERPNext directory.",
};

export default function EmployerSignupPage() {
  return (
    <main className="bg-canvas min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <ProductBrand subtitle="Finance that moves with you." />
          <Link className="text-brand text-sm font-semibold" href="/sign-in">
            Already have an account? Sign in
          </Link>
        </div>
        <section className="border-brand-border/60 bg-surface rounded-3xl border p-6 shadow-xl shadow-slate-200/50 sm:p-10">
          <p className="text-brand text-sm font-semibold tracking-wide uppercase">
            Employer onboarding
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Create your organization
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            Create the administrator account first. You’ll connect ERPNext and
            invite employees in the next steps.
          </p>
          <div className="mt-8">
            <EmployerSignupForm />
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            Employee accounts are created only after you connect ERPNext and run
            the employee synchronization.
          </p>
        </section>
      </div>
    </main>
  );
}
