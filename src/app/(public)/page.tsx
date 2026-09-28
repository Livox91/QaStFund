import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <div>
        <p className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Foundation MVP
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Employee Lending Platform
        </h1>
        <Link
          className="mt-8 inline-flex rounded-md bg-slate-950 px-4 py-2.5 font-medium text-white hover:bg-slate-800"
          href="/sign-in"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
