import type { Metadata } from "next";

import { AudienceSections } from "./_components/audience-sections";
import { EmployerCallToAction } from "./_components/employer-cta";
import { FrequentlyAskedQuestions } from "./_components/faq";
import { Hero } from "./_components/hero";
import { HowItWorks } from "./_components/how-it-works";
import { LandingFooter } from "./_components/landing-footer";
import { LandingHeader } from "./_components/landing-header";
import { TrustSection } from "./_components/trust-section";

export const metadata: Metadata = {
  title: {
    absolute: "Employee Lending Platform | Workplace lending, made clear",
  },
  description:
    "An employer-enabled internal marketplace where verified employees can lend to and borrow from coworkers with transparent terms.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingHeader />
      <main>
        <Hero />
        <HowItWorks />
        <AudienceSections />
        <TrustSection />
        <FrequentlyAskedQuestions />
        <EmployerCallToAction />
      </main>
      <LandingFooter />
    </div>
  );
}
