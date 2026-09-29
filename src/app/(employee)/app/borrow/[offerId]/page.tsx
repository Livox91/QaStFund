import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmBorrowForm } from "@/app/(employee)/app/borrow/[offerId]/confirm-borrow-form";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { formatBasisPointsAsPercent } from "@/modules/lending/domain/lending-offer";
import {
  BorrowAmountOutOfRangeError,
  InsufficientOfferLiquidityError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import {
  getBorrowableOfferForActor,
  quoteBorrowFromOfferForActor,
} from "@/modules/loans/index.server";
import {
  borrowOfferAmountSchema,
  borrowOfferParamsSchema,
} from "@/modules/loans/schemas/borrow-from-offer.schema";
import { buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { Field, Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Review lending offer" };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function minorUnitsToInputValue(amount: bigint): string {
  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export default async function BorrowOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ amount?: string | string[] }>;
}) {
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

  const query = await searchParams;
  const amountValue = typeof query.amount === "string" ? query.amount : "";
  const parsedAmount = amountValue
    ? borrowOfferAmountSchema.safeParse({ amount: amountValue })
    : null;
  let summary: Awaited<ReturnType<typeof quoteBorrowFromOfferForActor>> | null =
    null;
  let quoteError: string | undefined;
  if (parsedAmount?.success) {
    try {
      summary = await quoteBorrowFromOfferForActor(
        actor,
        offer.id,
        parsedAmount.data.amount,
        now,
      );
    } catch (error) {
      if (
        error instanceof BorrowAmountOutOfRangeError ||
        error instanceof InsufficientOfferLiquidityError
      ) {
        quoteError = error.message;
      } else {
        throw error;
      }
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/app/borrow"
          >
            Back to marketplace
          </Link>
        }
        description="Choose an amount, review the exact terms, then confirm the loan."
        eyebrow="Borrow money"
        title="Review lending offer"
      />

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Offer terms</CardTitle>
            <CardDescription>
              Available until {dateFormatter.format(offer.expiresAt)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-5 text-sm">
              <div>
                <dt className="text-slate-500">Available</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  <CurrencyDisplay
                    amountMinorUnits={offer.availableAmountMinorUnits}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Duration</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {offer.durationDays} days
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Minimum</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  <CurrencyDisplay
                    amountMinorUnits={offer.minimumLoanAmountMinorUnits}
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Maximum</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  <CurrencyDisplay
                    amountMinorUnits={
                      offer.maximumLoanAmountMinorUnits <
                      offer.availableAmountMinorUnits
                        ? offer.maximumLoanAmountMinorUnits
                        : offer.availableAmountMinorUnits
                    }
                    currency={offer.currency}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Interest / fee</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {formatBasisPointsAsPercent(offer.feeRateBasisPoints)}
                </dd>
              </div>
            </dl>

            <form
              action={`/app/borrow/${offer.id}`}
              className="mt-7"
              method="get"
            >
              <Field
                error={
                  parsedAmount && !parsedAmount.success
                    ? parsedAmount.error.issues[0]?.message
                    : quoteError
                }
                hint={`Enter an amount in ${offer.currency}.`}
                htmlFor="amount"
                label="Amount to borrow"
              >
                <Input
                  defaultValue={amountValue}
                  id="amount"
                  inputMode="decimal"
                  min="0.01"
                  name="amount"
                  placeholder={minorUnitsToInputValue(
                    offer.minimumLoanAmountMinorUnits,
                  )}
                  required
                  step="0.01"
                  type="number"
                />
              </Field>
              <button
                className={buttonStyles({
                  className: "mt-4",
                  variant: "secondary",
                })}
                type="submit"
              >
                Review loan summary
              </button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loan summary</CardTitle>
            <CardDescription>
              These terms are snapshotted when you confirm.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary && parsedAmount?.success ? (
              <>
                <dl className="space-y-4 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Principal</dt>
                    <dd className="font-semibold">
                      <CurrencyDisplay
                        amountMinorUnits={summary.principalAmountMinorUnits}
                        currency={offer.currency}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Agreed fee</dt>
                    <dd className="font-semibold">
                      <CurrencyDisplay
                        amountMinorUnits={summary.feeAmountMinorUnits}
                        currency={offer.currency}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-slate-100 pt-4">
                    <dt className="font-medium text-slate-700">
                      Total repayment
                    </dt>
                    <dd className="text-lg font-semibold text-slate-950">
                      <CurrencyDisplay
                        amountMinorUnits={summary.totalRepaymentMinorUnits}
                        currency={offer.currency}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Repayment date</dt>
                    <dd className="font-semibold">
                      {dateFormatter.format(summary.repaymentDueAt)}
                    </dd>
                  </div>
                </dl>
                <p className="my-5 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                  Confirmation reserves pledged offer capital and creates an
                  active loan. No money or blockchain transaction occurs.
                </p>
                <ConfirmBorrowForm
                  amount={amountValue}
                  offerId={offer.id}
                  requestId={crypto.randomUUID()}
                />
              </>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Enter a valid amount to see the final repayment terms.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
