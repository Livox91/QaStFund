import Link from "next/link";

import { buttonStyles } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

export default function EmployerLoanNotFound() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <EmptyState
        action={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/employer/loans"
          >
            Back to loans
          </Link>
        }
        description="The loan does not exist or is not available within your organization."
        title="Loan not found"
      />
    </main>
  );
}
