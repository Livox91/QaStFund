import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Employee Dashboard",
};

export default function EmployeeDashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
        Employee Dashboard
      </h1>
    </main>
  );
}
