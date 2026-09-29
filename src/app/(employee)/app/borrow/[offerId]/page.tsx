import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmBorrowForm } from "@/app/(employee)/app/borrow/[offerId]/confirm-borrow-form";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import {
  calculateEstimatedRepayment,
  formatBasisPointsAsPercent,
} from "@/modules/lending/domain/lending-offer";
import { LendingOfferNotAvailableError } from "@/modules/loans/application/errors/borrow-loan-errors";
import { getBorrowableOfferForActor } from "@/modules/loans/index.server";
import { borrowOfferParamsSchema } from "@/modules/loans/schemas/borrow-from-offer.schema";
import { buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Review loan" };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function BorrowOfferPage({
  params,
}: PageProps<"/app/borrow/[offerId]">) {
  const parsedParams = borrowOfferParamsSchema.safeParse(await params);
  if (!parsedParams.success) notFound();

  const actor = await requireEmployeePage();
  const now = new Date();
  let offer;
  try {
    offer = await getBorrowableOfferForActor(
      actor,
      parsedParams.data.offerId,
      now,
    );
  } catch (error) {
    if (error instanceof LendingOfferNotAvailableError) notFound();
    throw error;
  }

  const repayment = calculateEstimatedRepayment(
    offer.availableAmountMinorUnits,
    offer.feeRateBasisPoints,
  );
  const interest = repayment - offer.availableAmountMinorUnits;
  const estimatedDueAt = new Date(
    now.getTime() + offer.durationDays * 86_400_000,
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/app/borrow"
          >
            Back to offers
          </Link>
        }
        description="Review the amount you receive and your complete repayment obligation."
        eyebrow="Borrow money"
        title="Review loan"
      />

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Offer from {offer.lenderName ?? "a coworker"}</CardTitle>
            <CardDescription>
              A single, fully funded loan from a verified employee.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-5 text-sm">
              <div>
                <dt className="text-slate-500">You receive</dt>
                <dd className="mt-1 text-xl font-semibold text-slate-950">
                  <CurrencyDisplay
                    amountMinorUnits={offer.availableAmountMinorUnits}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Interest</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {formatBasisPointsAsPercent(offer.feeRateBasisPoints)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Term</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {offer.durationDays} days
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Estimated due date</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {dateFormatter.format(estimatedDueAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your repayment obligation</CardTitle>
            <CardDescription>
              The final due date is set from the confirmed funding time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">You receive</dt>
                <dd className="font-semibold">
                  <CurrencyDisplay
                    amountMinorUnits={offer.availableAmountMinorUnits}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Interest</dt>
                <dd className="font-semibold">
                  <CurrencyDisplay
                    amountMinorUnits={interest}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-100 pt-4">
                <dt className="font-medium text-slate-700">You repay</dt>
                <dd className="text-lg font-semibold text-slate-950">
                  <CurrencyDisplay
                    amountMinorUnits={repayment}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Due</dt>
                <dd className="font-semibold">
                  {dateFormatter.format(estimatedDueAt)}
                </dd>
              </div>
            </dl>
            <p className="my-5 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              Confirmation releases the secured funds to your wallet and starts
              the loan. If the offer was taken moments earlier, nothing is
              transferred.
            </p>
            <ConfirmBorrowForm offerId={offer.id} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
