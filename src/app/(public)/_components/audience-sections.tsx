import { LandingIcon, type LandingIconName } from "./landing-icon";
import { SectionHeading } from "./section-heading";

type Benefit = Readonly<{
  description: string;
  icon: LandingIconName;
  title: string;
}>;

const employeeBenefits: ReadonlyArray<Benefit> = [
  {
    description: "Find short-term support inside a verified workplace network.",
    icon: "wallet",
    title: "Access to liquidity",
  },
  {
    description:
      "Review the amount, duration, cost, and due date before borrowing.",
    icon: "eye",
    title: "Transparent terms",
  },
  {
    description:
      "Follow a clear schedule and keep repayment status in one place.",
    icon: "document",
    title: "Simple repayment",
  },
  {
    description:
      "Put available funds to work by creating lending offers for coworkers.",
    icon: "coins",
    title: "Potential to earn",
  },
];

const employerBenefits: ReadonlyArray<Benefit> = [
  {
    description:
      "Offer another practical resource for employees facing short-term needs.",
    icon: "spark",
    title: "Financial wellness",
  },
  {
    description:
      "Keep participation inside a defined, organization-specific program.",
    icon: "shield",
    title: "Controlled environment",
  },
  {
    description:
      "Set eligibility and program rules that reflect company requirements.",
    icon: "document",
    title: "Configurable policies",
  },
  {
    description:
      "Understand activity, outstanding obligations, and program history.",
    icon: "eye",
    title: "Visibility and reporting",
  },
];

function BenefitList({ benefits }: { benefits: ReadonlyArray<Benefit> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {benefits.map((benefit) => (
        <article
          key={benefit.title}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <LandingIcon name={benefit.icon} />
          </span>
          <h3 className="mt-4 font-semibold text-slate-950">{benefit.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {benefit.description}
          </p>
        </article>
      ))}
    </div>
  );
}

export function AudienceSections() {
  return (
    <>
      <section className="bg-white py-20 sm:py-24" id="employees">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <SectionHeading
            description="Borrow when a short-term need arises, or participate as a lender when you have money available. Every offer is presented with clear terms."
            eyebrow="For employees"
            title="More useful options for your money"
          />
          <BenefitList benefits={employeeBenefits} />
        </div>
      </section>

      <section
        className="bg-slate-950 py-20 !text-white sm:py-24"
        id="employers"
      >
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {employerBenefits.map((benefit) => (
              <article
                key={benefit.title}
                className="rounded-2xl border border-white/10 bg-white/[0.06] p-5"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300">
                  <LandingIcon name={benefit.icon} />
                </span>
                <h3 className="mt-4 font-semibold !text-white">
                  {benefit.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {benefit.description}
                </p>
              </article>
            ))}
          </div>
          <div className="lg:order-last">
            <p className="text-sm font-semibold tracking-wide text-teal-300 uppercase">
              For employers
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] !text-white sm:text-4xl">
              Support employees within a program you can govern
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              Give employees access to a structured internal marketplace while
              keeping organizational policies, participation, and reporting in
              view.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
