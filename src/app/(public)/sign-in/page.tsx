import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getRoleHome } from "@/modules/auth/domain/application-role";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";

export const metadata: Metadata = {
  title: "Sign in",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Enter a valid email address and password.",
  invalid_credentials: "Invalid email or password.",
  sign_in_failed: "Unable to sign in right now. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const actor = await getCurrentActor();

  if (actor) {
    redirect(getRoleHome(actor.role));
  }

  const error = (await searchParams).error;
  const errorCode = typeof error === "string" ? error : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6 py-16">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Employee Lending Platform
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Use your organization account to continue.
        </p>

        {errorCode && ERROR_MESSAGES[errorCode] ? (
          <p
            className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {ERROR_MESSAGES[errorCode]}
          </p>
        ) : null}

        <form
          className="mt-6 space-y-5"
          action="/api/auth/sign-in"
          method="post"
        >
          <div>
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="email"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-500"
              id="email"
              name="email"
              required
              type="email"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="password"
            >
              Password
            </label>
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-500"
              id="password"
              maxLength={128}
              name="password"
              required
              type="password"
            />
          </div>
          <button
            className="w-full cursor-pointer rounded-md bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800"
            type="submit"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
