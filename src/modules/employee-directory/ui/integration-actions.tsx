"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  configureIntegrationAction,
  syncEmployeesAction,
  testIntegrationAction,
  type IntegrationActionState,
} from "@/app/(employer)/employer/integrations/actions";
import { Button, buttonStyles } from "@/shared/ui/button";

const initialState: IntegrationActionState = { status: "idle", message: "" };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit">
      {pending ? "Working…" : children}
    </Button>
  );
}

function Result({ state }: { state: IntegrationActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      aria-live="polite"
      className={
        state.status === "error"
          ? "text-sm text-red-700"
          : state.status === "partial"
            ? "text-sm text-amber-700"
            : "text-sm text-emerald-700"
      }
    >
      {state.message}
    </p>
  );
}

export function IntegrationOperations({ retry }: { retry: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ConnectionTestButton />
      <EmployeeSyncButton retry={retry} />
      <a
        className={buttonStyles({ variant: "outline" })}
        href="#review-unmatched"
      >
        Review unmatched
      </a>
    </div>
  );
}

export function ConnectionTestButton() {
  const [testState, testAction] = useActionState(
    testIntegrationAction,
    initialState,
  );
  return (
    <form action={testAction} className="flex flex-wrap items-center gap-3">
      <SubmitButton>Test connection</SubmitButton>
      <Result state={testState} />
    </form>
  );
}

export function EmployeeSyncButton({ retry = false }: { retry?: boolean }) {
  const [syncState, syncAction] = useActionState(
    syncEmployeesAction,
    initialState,
  );
  return (
    <form action={syncAction} className="flex flex-wrap items-center gap-3">
      <SubmitButton>
        {retry ? "Retry synchronization" : "Sync employees"}
      </SubmitButton>
      <Result state={syncState} />
    </form>
  );
}

export function IntegrationConfigurationForm({
  defaults,
}: {
  defaults?: {
    baseUrl: string;
    apiPath: string;
    apiVersion: string;
    authMethod: "token" | "oauth_bearer";
    credentialConfigured: boolean;
    timeoutMs: number;
    statusMapping: Readonly<Record<string, string | null>>;
  };
}) {
  const [state, action] = useActionState(
    configureIntegrationAction,
    initialState,
  );
  const [authMethod, setAuthMethod] = useState<"token" | "oauth_bearer">(
    defaults?.authMethod ?? "token",
  );
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const apiSecretRef = useRef<HTMLInputElement>(null);
  const accessTokenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status !== "success") return;
    if (apiKeyRef.current) apiKeyRef.current.value = "";
    if (apiSecretRef.current) apiSecretRef.current.value = "";
    if (accessTokenRef.current) accessTokenRef.current.value = "";
  }, [state.status]);
  const fieldClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium text-slate-700 md:col-span-2">
        ERPNext base URL
        <input
          className={fieldClass}
          defaultValue={defaults?.baseUrl}
          name="baseUrl"
          placeholder="https://erp.example.com"
          required
        />
      </label>
      <label className="text-sm font-medium text-slate-700">
        API path
        <input
          className={fieldClass}
          defaultValue={defaults?.apiPath ?? "/api/resource"}
          name="apiPath"
          required
        />
      </label>
      <label className="text-sm font-medium text-slate-700">
        API version
        <input
          className={fieldClass}
          defaultValue={defaults?.apiVersion ?? "v1"}
          name="apiVersion"
          required
        />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Authentication
        <select
          className={fieldClass}
          defaultValue={defaults?.authMethod ?? "token"}
          name="authMethod"
          onChange={(event) =>
            setAuthMethod(event.target.value as "token" | "oauth_bearer")
          }
        >
          <option value="token">API token</option>
          <option value="oauth_bearer">OAuth bearer token</option>
        </select>
      </label>
      {authMethod === "token" ? (
        <>
          <label className="text-sm font-medium text-slate-700">
            ERPNext API key
            <input
              autoComplete="off"
              className={fieldClass}
              name="apiKey"
              ref={apiKeyRef}
              required={
                !defaults?.credentialConfigured ||
                defaults.authMethod !== authMethod
              }
              type="password"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            ERPNext API secret
            <input
              autoComplete="new-password"
              className={fieldClass}
              name="apiSecret"
              ref={apiSecretRef}
              required={
                !defaults?.credentialConfigured ||
                defaults.authMethod !== authMethod
              }
              type="password"
            />
          </label>
        </>
      ) : (
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          ERPNext OAuth access token
          <input
            autoComplete="new-password"
            className={fieldClass}
            name="accessToken"
            ref={accessTokenRef}
            required={
              !defaults?.credentialConfigured ||
              defaults.authMethod !== authMethod
            }
            type="password"
          />
        </label>
      )}
      {defaults?.credentialConfigured ? (
        <p className="text-xs text-slate-500 md:col-span-2">
          Credentials are already stored. Leave the credential fields blank to
          keep them, or enter replacements to rotate them.
        </p>
      ) : null}
      <label className="text-sm font-medium text-slate-700">
        Timeout (milliseconds)
        <input
          className={fieldClass}
          defaultValue={defaults?.timeoutMs ?? 5000}
          max={30000}
          min={500}
          name="timeoutMs"
          type="number"
          required
        />
      </label>
      {(["active", "inactive", "left", "suspended"] as const).map(
        (external) => (
          <label className="text-sm font-medium text-slate-700" key={external}>
            ERPNext “{external}” maps to
            <select
              className={fieldClass}
              defaultValue={
                (defaults?.statusMapping[external] ?? external === "active")
                  ? "ACTIVE"
                  : external === "left"
                    ? "TERMINATED"
                    : "SUSPENDED"
              }
              name={`${external}Status`}
            >
              <option value="IGNORE">Review only (no change)</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
          </label>
        ),
      )}
      <div className="flex items-center gap-3 md:col-span-2">
        <SubmitButton>Save configuration</SubmitButton>
        <Result state={state} />
      </div>
    </form>
  );
}
