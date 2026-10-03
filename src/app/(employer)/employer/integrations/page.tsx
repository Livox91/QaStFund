import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeDirectoryDashboardForActor } from "@/modules/employee-directory/index.server";
import {
  IntegrationConfigurationForm,
  IntegrationOperations,
} from "@/modules/employee-directory/ui/integration-actions";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

export const metadata: Metadata = { title: "ERPNext Integration" };

function date(value: Date | null) {
  return value ? value.toLocaleString() : "Never";
}

export default async function EmployerIntegrationsPage() {
  const dashboard = await getEmployeeDirectoryDashboardForActor(
    await requireEmployerAdminPage(),
  );
  const latest = dashboard.latestRun;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Verify employees and synchronize approved employment-status fields through a read-only ERPNext connection."
        eyebrow="Employer portal"
        title="ERPNext integration"
      />
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Connection</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Status"
            value={dashboard.integration?.connectionStatus ?? "Not configured"}
          />
          <Metric
            label="Last tested"
            value={date(dashboard.integration?.lastTestedAt ?? null)}
          />
          <Metric
            label="Last successful sync"
            value={date(dashboard.integration?.lastSuccessfulSyncAt ?? null)}
          />
          <Metric
            label="Latest result"
            value={dashboard.integration?.lastSyncStatus ?? "No sync"}
          />
          <Metric
            label="Last attempted sync"
            value={date(latest?.startedAt ?? null)}
          />
          <Metric
            label="Next scheduled sync"
            value={
              !dashboard.schedule.enabled
                ? "Disabled"
                : dashboard.schedule.pausedCode
                  ? "Paused"
                  : date(dashboard.schedule.nextScheduledSyncAt)
            }
          />
        </div>
        {latest?.safeErrorSummary ? (
          <p className="mt-4 text-sm text-red-700">{latest.safeErrorSummary}</p>
        ) : null}
        {dashboard.schedule.pausedCode ? (
          <p className="mt-2 text-sm text-amber-700">
            Scheduled synchronization is paused after a permanent configuration
            or permission error. A successful manual retry resumes it.
          </p>
        ) : null}
        {dashboard.configured ? (
          <div className="mt-6">
            <IntegrationOperations retry={latest?.status === "failed"} />
          </div>
        ) : null}
      </section>
      {latest ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Latest synchronization
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Processed" value={String(latest.processedCount)} />
            <Metric label="Created" value={String(latest.createdCount)} />
            <Metric label="Updated" value={String(latest.updatedCount)} />
            <Metric label="Unchanged" value={String(latest.unchangedCount)} />
            <Metric label="Needs review" value={String(latest.reviewCount)} />
            <Metric
              label="Duration"
              value={
                latest.durationMs === null
                  ? "Running"
                  : `${latest.durationMs} ms`
              }
            />
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Correlation ID: {latest.correlationId}
          </p>
        </section>
      ) : null}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Configuration</h2>
        <p className="mt-1 text-sm text-slate-600">
          The credential value stays in server environment storage. This form
          saves only its organization-scoped reference.
        </p>
        <div className="mt-5">
          <IntegrationConfigurationForm
            defaults={
              dashboard.integration
                ? {
                    baseUrl: dashboard.integration.baseUrl,
                    apiPath: dashboard.integration.apiPath,
                    apiVersion: dashboard.integration.apiVersion,
                    authMethod: dashboard.integration.authMethod,
                    timeoutMs: dashboard.integration.timeoutMs,
                    statusMapping: dashboard.integration.statusMapping,
                  }
                : undefined
            }
          />
        </div>
      </section>
      <section className="mt-6" id="review-unmatched">
        <h2 className="text-lg font-semibold text-slate-950">Needs review</h2>
        <p className="mt-1 text-sm text-slate-600">
          Unmatched, ambiguous, and duplicate external records are never merged
          automatically.
        </p>
        <TableContainer className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ERPNext employee</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.reviewRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    No records currently need review.
                  </TableCell>
                </TableRow>
              ) : (
                dashboard.reviewRecords.map((record) => (
                  <TableRow key={record.externalEmployeeId}>
                    <TableCell>
                      <span className="font-medium">{record.fullName}</span>
                      <br />
                      <span className="text-xs text-slate-500">
                        {record.employeeCode ?? record.externalEmployeeId}
                      </span>
                    </TableCell>
                    <TableCell>{record.email ?? "Missing"}</TableCell>
                    <TableCell>{record.externalStatus}</TableCell>
                    <TableCell>
                      {record.statusMapped
                        ? record.matchStatus.replaceAll("_", " ")
                        : "unmapped employment status"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </section>
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-slate-950">Sync history</h2>
        <TableContainer className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Processed</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    No synchronization runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                dashboard.history.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{date(run.startedAt)}</TableCell>
                    <TableCell>{run.trigger}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{run.processedCount}</TableCell>
                    <TableCell>{run.updatedCount}</TableCell>
                    <TableCell>{run.reviewCount}</TableCell>
                    <TableCell>
                      {run.durationMs === null
                        ? "Running"
                        : `${run.durationMs} ms`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold break-words text-slate-950 capitalize">
        {value.replaceAll("_", " ")}
      </dd>
    </div>
  );
}
