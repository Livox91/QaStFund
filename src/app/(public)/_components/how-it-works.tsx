import { LandingIcon, type LandingIconName } from "./landing-icon";
import { SectionHeading } from "./section-heading";

const steps: ReadonlyArray<{
  description: string;
  icon: LandingIconName;
  title: string;
}> = [
  {
    description: "An employer sets up an organization-scoped lending program.",
    icon: "building",
    title: "Company joins",
  },
  {
    description: "Eligible employees are confirmed within their organization.",
    icon: "shield",
    title: "Employees are verified",
  },
  {
    description: "Employees with spare money can make it available to lend.",
    icon: "coins",
    title: "Liquidity is provided",
  },
  {
    description: "Coworkers can review available terms and request funds.",
    icon: "wallet",
    title: "Coworkers borrow",
  },
  {
    description: "Schedules and repayment status are managed in the platform.",
    icon: "document",
    title: "Repayments are tracked",
  },
];

export function HowItWorks() {
  return (
    <section
      className="border-y border-slate-200 bg-slate-50 py-20 sm:py-24"
      id="how-it-works"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          align="center"
          description="The company provides the trusted environment. Employees create the marketplace. The platform keeps every step clear."
          eyebrow="How it works"
          title="A straightforward flow from enrollment to repayment"
        />

        <ol className="relative mt-14 grid gap-4 md:grid-cols-5">
          <div
            aria-hidden="true"
            className="absolute top-7 right-[10%] left-[10%] hidden h-px bg-slate-300 md:block"
          />
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="relative z-10 flex items-center justify-between md:block">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm md:mx-auto">
                  <LandingIcon className="size-6" name={step.icon} />
                </span>
                <span className="text-xs font-bold text-slate-400 md:mt-5 md:block md:text-center">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-950 md:text-center">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500 md:text-center">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
