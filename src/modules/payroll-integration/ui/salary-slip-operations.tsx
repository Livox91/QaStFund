"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Field, Input, Select } from "@/shared/ui/input";

type Result = {
  externalId: string;
  grossPayMinorUnits: string;
  netPayMinorUnits: string;
  currency: string;
  documentStatus: number;
};

async function responseMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return (
    body?.error?.message ?? `Request failed with status ${response.status}`
  );
}

export function SalarySlipOperations({
  employees,
}: {
  employees: ReadonlyArray<{
    id: string;
    fullName: string;
    employeeCode: string | null;
  }>;
}) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  const [employeeMappingId, setEmployeeMappingId] = useState(
    employees[0]?.id ?? "",
  );
  const [periodStart, setPeriodStart] = useState(
    first.toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(last.toISOString().slice(0, 10));
  const [busy, setBusy] = useState<"list" | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<ReadonlyArray<Result>>([]);

  async function run(mode: "list" | "create") {
    setBusy(mode);
    setMessage(null);
    try {
      const input = { employeeMappingId, periodStart, periodEnd };
      const response = await fetch(
        mode === "list"
          ? `/api/employer/payroll/salary-slips?${new URLSearchParams(input)}`
          : "/api/employer/payroll/salary-slips",
        mode === "list"
          ? { credentials: "include", cache: "no-store" }
          : {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as {
        data?: { salarySlips?: Result[]; evidence?: Result };
        salarySlips?: Result[];
        evidence?: Result;
      };
      const payload = body.data ?? body;
      const next =
        payload.salarySlips ?? (payload.evidence ? [payload.evidence] : []);
      setResults(next);
      setMessage(
        mode === "create"
          ? "Draft created in Frappe HR. Review it there before any submission."
          : next.length
            ? `${next.length} salary slip found.`
            : "No draft or submitted salary slip exists for this period.",
      );
    } catch (error) {
      setResults([]);
      setMessage(
        error instanceof Error ? error.message : "Payroll request failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (employees.length === 0)
    return (
      <p className="text-sm text-slate-600">
        No active mapped ERPNext employees are available.
      </p>
    );

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field htmlFor="salary-employee" label="Employee">
          <Select
            id="salary-employee"
            value={employeeMappingId}
            onChange={(event) => setEmployeeMappingId(event.target.value)}
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
                {employee.employeeCode ? ` · ${employee.employeeCode}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="salary-period-start" label="Period start">
          <Input
            id="salary-period-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
        </Field>
        <Field htmlFor="salary-period-end" label="Period end">
          <Input
            id="salary-period-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={busy !== null}
          isLoading={busy === "list"}
          onClick={() => void run("list")}
          type="button"
          variant="outline"
        >
          Check salary slips
        </Button>
        <Button
          disabled={busy !== null}
          isLoading={busy === "create"}
          onClick={() => void run("create")}
          type="button"
        >
          Create draft salary slip
        </Button>
      </div>
      {message ? (
        <p className="mt-4 text-sm text-slate-700" role="status">
          {message}
        </p>
      ) : null}
      {results.length ? (
        <ul className="mt-4 space-y-2 text-sm text-slate-700">
          {results.map((result) => (
            <li className="rounded-lg bg-slate-50 p-3" key={result.externalId}>
              {result.externalId} · {result.currency}{" "}
              {(Number(result.netPayMinorUnits) / 100).toFixed(2)} net ·{" "}
              {result.documentStatus === 1 ? "Submitted" : "Draft"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
