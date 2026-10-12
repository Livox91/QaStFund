import Link from "next/link";

import { buttonStyles } from "@/shared/ui/button";

import { LandingIcon } from "./landing-icon";

export function EmployerCallToAction() {
  return (
    <section className="bg-surface py-20 sm:py-24" id="employer-interest">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="bg-brand shadow-brand/10 relative isolate overflow-hidden rounded-3xl px-6 py-12 !text-white shadow-xl sm:px-10 sm:py-14 lg:flex lg:items-center lg:justify-between lg:gap-16 lg:px-14">
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-20 -z-10 size-80 rounded-full border-[56px] border-white/10"
          />
          <div className="max-w-2xl">
            <p className="text-brand-muted text-sm font-semibold tracking-wide uppercase">
              For employer teams
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] !text-white sm:text-4xl">
              Explore a more structured approach to employee liquidity
            </h2>
            <p className="text-brand-soft/90 mt-4 text-base leading-7">
              Bring HR and finance together around a controlled internal program
              with visible terms, organization-level policies, and a clear path
              from participation to repayment.
            </p>
          </div>
          <div className="mt-8 flex shrink-0 flex-col gap-3 sm:flex-row lg:mt-0 lg:flex-col">
            <Link
              className={buttonStyles({
                className: "hover:bg-brand-soft bg-white !text-slate-950",
                size: "lg",
              })}
              href="/signup"
            >
              Create employer account
              <LandingIcon className="size-4" name="arrow" />
            </Link>
            <Link
              className={buttonStyles({
                className:
                  "border-white/30 bg-transparent !text-white hover:bg-white/10",
                size: "lg",
                variant: "outline",
              })}
              href="/#how-it-works"
            >
              Review how it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
