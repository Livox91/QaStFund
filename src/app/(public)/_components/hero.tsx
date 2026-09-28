import Link from "next/link";

import { buttonStyles } from "@/shared/ui/button";

import { LandingIcon } from "./landing-icon";

function FlowCard({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: "coins" | "people" | "wallet";
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
        <LandingIcon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-950">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{detail}</span>
      </span>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-white">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(circle_at_75%_25%,rgba(20,184,166,0.13),transparent_34%),radial-gradient(circle_at_20%_10%,rgba(15,23,42,0.06),transparent_30%)]"
      />
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-28">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">
            <span className="size-1.5 rounded-full bg-teal-500" />
            Employer-enabled. Employee-powered.
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-slate-950 sm:text-5xl lg:text-[3.75rem]">
            Short-term lending,
            <span className="block text-teal-700">within the workplace.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            An internal marketplace where verified employees can lend spare
            funds to coworkers who need short-term liquidity—with clear terms
            and repayment managed through one platform.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              className={buttonStyles({ size: "lg", variant: "secondary" })}
              href="/#employer-interest"
            >
              Explore for your company
              <LandingIcon className="size-4" name="arrow" />
            </Link>
            <Link
              className={buttonStyles({ size: "lg", variant: "outline" })}
              href="/#how-it-works"
            >
              See how it works
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            {[
              "Organization-scoped",
              "Transparent terms",
              "Policy controlled",
            ].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <LandingIcon className="size-3.5" name="check" />
                </span>
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl lg:mx-0 lg:justify-self-end">
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-teal-100/60 blur-2xl"
          />
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-2xl shadow-slate-300/40 sm:p-7">
            <div className="flex items-center justify-between border-b border-slate-200 pb-5">
              <div>
                <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  Internal marketplace
                </p>
                <p className="mt-1 text-base font-semibold text-slate-950">
                  One trusted company network
                </p>
              </div>
              <span className="flex size-9 items-center justify-center rounded-full bg-slate-950 text-white">
                <LandingIcon className="size-4" name="building" />
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <FlowCard
                detail="Offers spare funds"
                icon="coins"
                title="Employee lender"
              />
              <div className="hidden text-teal-600 sm:block">
                <LandingIcon name="arrow" />
              </div>
              <FlowCard
                detail="Gets short-term access"
                icon="wallet"
                title="Employee borrower"
              />
            </div>

            <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-300">
                  <LandingIcon name="people" />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    The platform connects both sides
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Eligibility, offer terms, loan status, and repayment
                    schedules stay visible in one controlled experience.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
