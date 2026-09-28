import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Employer Dashboard",
};

export default function EmployerDashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
        Employer Dashboard
      </h1>
    </main>
  );
}
