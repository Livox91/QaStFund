import { LandingIcon, type LandingIconName } from "./landing-icon";
import { SectionHeading } from "./section-heading";

const trustPrinciples: ReadonlyArray<{
  description: string;
  icon: LandingIconName;
  title: string;
}> = [
  {
    description:
      "Participation is tied to a verified employee and their organization.",
    icon: "people",
    title: "Verified participation",
  },
  {
    description:
      "Each company operates within its own organization-scoped workspace.",
    icon: "building",
    title: "Clear boundaries",
  },
  {
    description:
      "Amounts, timing, costs, and repayment expectations are visible up front.",
    icon: "eye",
    title: "Understandable terms",
  },
  {
    description:
      "Program access and sensitive actions are enforced by the server.",
    icon: "shield",
    title: "Controlled access",
  },
];

export function TrustSection() {
  return (
    <section className="bg-white py-20 sm:py-24" id="trust">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          align="center"
          description="Workplace lending involves people, money, and responsibility. The product is designed around scoped access, visible obligations, and employer-defined participation."
          eyebrow="Security and trust"
          title="Clear rules are part of the product"
        />

        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {trustPrinciples.map((principle) => (
            <article key={principle.title} className="bg-slate-50 p-6 sm:p-7">
              <LandingIcon
                className="size-6 text-teal-700"
                name={principle.icon}
              />
              <h3 className="mt-5 font-semibold text-slate-950">
                {principle.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {principle.description}
              </p>
            </article>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-5 text-slate-500">
          Payment rails, repayment methods, eligibility rules, and feature
          availability depend on each employer&apos;s configured program and
          implementation stage.
        </p>
      </div>
    </section>
  );
}
