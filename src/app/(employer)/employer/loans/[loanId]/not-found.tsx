import Link from "next/link";

import { buttonStyles } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

export default function EmployerLoanNotFound() {
  return (
    <main className="app-page app-page-narrow">
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
