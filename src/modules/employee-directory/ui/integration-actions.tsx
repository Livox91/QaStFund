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
import { Field, Input, Select } from "@/shared/ui/input";

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
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field
        className="md:col-span-2"
        htmlFor="erp-base-url"
        label="ERPNext base URL"
      >
        <Input
          defaultValue={defaults?.baseUrl}
          id="erp-base-url"
          name="baseUrl"
          placeholder="https://erp.example.com"
          required
        />
      </Field>
      <Field htmlFor="erp-api-path" label="API path">
        <Input
          defaultValue={defaults?.apiPath ?? "/api/resource"}
          id="erp-api-path"
          name="apiPath"
          required
        />
      </Field>
      <Field htmlFor="erp-api-version" label="API version">
        <Input
          defaultValue={defaults?.apiVersion ?? "v1"}
          id="erp-api-version"
          name="apiVersion"
          required
        />
      </Field>
      <Field htmlFor="erp-auth-method" label="Authentication">
        <Select
          defaultValue={defaults?.authMethod ?? "token"}
          id="erp-auth-method"
          name="authMethod"
          onChange={(event) =>
            setAuthMethod(event.target.value as "token" | "oauth_bearer")
          }
        >
          <option value="token">API token</option>
          <option value="oauth_bearer">OAuth bearer token</option>
        </Select>
      </Field>
      {authMethod === "token" ? (
        <>
          <Field htmlFor="erp-api-key" label="ERPNext API key">
            <Input
              autoComplete="off"
              id="erp-api-key"
              name="apiKey"
              ref={apiKeyRef}
              required={
                !defaults?.credentialConfigured ||
                defaults.authMethod !== authMethod
              }
              type="password"
            />
          </Field>
          <Field htmlFor="erp-api-secret" label="ERPNext API secret">
            <Input
              autoComplete="new-password"
              id="erp-api-secret"
              name="apiSecret"
              ref={apiSecretRef}
              required={
                !defaults?.credentialConfigured ||
                defaults.authMethod !== authMethod
              }
              type="password"
            />
          </Field>
        </>
      ) : (
        <Field
          className="md:col-span-2"
          htmlFor="erp-access-token"
          label="ERPNext OAuth access token"
        >
          <Input
            autoComplete="new-password"
            id="erp-access-token"
            name="accessToken"
            ref={accessTokenRef}
            required={
              !defaults?.credentialConfigured ||
              defaults.authMethod !== authMethod
            }
            type="password"
          />
        </Field>
      )}
      {defaults?.credentialConfigured ? (
        <p className="text-xs text-slate-500 md:col-span-2">
          Credentials are already stored. Leave the credential fields blank to
          keep them, or enter replacements to rotate them.
        </p>
      ) : null}
      <Field htmlFor="erp-timeout" label="Timeout (milliseconds)">
        <Input
          defaultValue={defaults?.timeoutMs ?? 5000}
          id="erp-timeout"
          max={30000}
          min={500}
          name="timeoutMs"
          type="number"
          required
        />
      </Field>
      {(["active", "inactive", "left", "suspended"] as const).map(
        (external) => (
          <Field
            htmlFor={`erp-status-${external}`}
            key={external}
            label={`ERPNext “${external}” maps to`}
          >
            <Select
              defaultValue={
                (defaults?.statusMapping[external] ?? external === "active")
                  ? "ACTIVE"
                  : external === "left"
                    ? "TERMINATED"
                    : "SUSPENDED"
              }
              id={`erp-status-${external}`}
              name={`${external}Status`}
            >
              <option value="IGNORE">Review only (no change)</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </Select>
          </Field>
        ),
      )}
      <div className="flex items-center gap-3 md:col-span-2">
        <SubmitButton>Save configuration</SubmitButton>
        <Result state={state} />
      </div>
    </form>
  );
}
