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
    absolute: "QastFund | Finance that moves with you",
  },
  description:
    "Employer-enabled lending and peer-to-peer funding for verified workplace communities, with transparent terms and controlled access.",
};

export default function LandingPage() {
  return (
    <div className="bg-canvas min-h-screen">
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
