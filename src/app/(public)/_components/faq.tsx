import { SectionHeading } from "./section-heading";

const questions = [
  {
    answer:
      "It is software for an employer-enabled lending marketplace. A company establishes the program, eligible employees are verified, and those employees can participate as lenders or borrowers within that organization.",
    question: "What exactly is the employee lending platform?",
  },
  {
    answer:
      "Not necessarily. The marketplace is designed for employees to provide liquidity to coworkers. The employer enables the program, verifies participation, and defines the policies that govern it.",
    question: "Does the employer provide the money?",
  },
  {
    answer:
      "No. Participation is organization-scoped. Employees interact within the program established by their employer rather than through an open public marketplace.",
    question: "Can employees lend to people outside their company?",
  },
  {
    answer:
      "Every offer is intended to show its amount, duration, cost, repayment date, and applicable status clearly before an employee borrows. Employer policies can also set boundaries for the program.",
    question: "How are lending terms communicated?",
  },
  {
    answer:
      "The platform is designed to present repayment schedules and track status in one place. The actual repayment method depends on the employer's program and the settlement or payroll integrations configured for it.",
    question: "How do repayments work?",
  },
] as const;

export function FrequentlyAskedQuestions() {
  return (
    <section
      className="border-t border-slate-200 bg-slate-50 py-20 sm:py-24"
      id="faq"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
        <SectionHeading
          description="A concise guide for employees and employers evaluating the model for the first time."
          eyebrow="FAQ"
          title="Questions worth asking"
        />
        <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5 shadow-sm sm:px-7">
          {questions.map((item, index) => (
            <details key={item.question} className="group" open={index === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left font-semibold text-slate-950 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-normal text-slate-500 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pb-5 text-sm leading-7 text-slate-600">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
