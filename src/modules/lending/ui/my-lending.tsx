import Link from "next/link";

import { updateLendingOfferStatusAction } from "@/app/(employee)/app/lending/actions";
import type { EmployeeLendingOverview } from "@/modules/lending/domain/lending-offer";
import {
  calculateEstimatedRepayment,
  formatBasisPointsAsPercent,
} from "@/modules/lending/domain/lending-offer";
import { CreateLendingOfferForm } from "@/modules/lending/ui/create-lending-offer-form";
import { Button, buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusDisplay } from "@/shared/ui/status-display";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function BalanceItem({
  amount,
  currency,
  label,
}: {
  amount: bigint;
  currency: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <CurrencyDisplay
        amountMinorUnits={amount}
        className="mt-2 block text-xl font-semibold text-slate-950"
        currency={currency}
      />
    </div>
  );
}

export function MyLending({
  created,
  offerUpdated,
  overview,
  statusError,
}: {
  created: boolean;
  offerUpdated: boolean;
  overview: EmployeeLendingOverview;
  statusError: boolean;
}) {
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/app/borrow"
          >
            Lending Marketplace
          </Link>
        }
        description="Create and monitor the funds you make available to coworkers."
        eyebrow="Employee portal"
        title="My Lending"
      />

      {created ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
        >
          Your lending offer is active and now visible in the marketplace.
        </p>
      ) : null}

      {offerUpdated ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
        >
          Your lending offer status was updated.
        </p>
      ) : null}

      {statusError ? (
        <p
          className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          That offer status change is not allowed.
        </p>
      ) : null}

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card id="new-offer">
          <CardHeader>
            <CardTitle>Create a lending offer</CardTitle>
            <CardDescription>
              Choose terms, then use your wallet passkey to secure the USDC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateLendingOfferForm currency={overview.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funded capital</CardTitle>
            <CardDescription>
              USDC secured in confirmed, active lending offers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceItem
              amount={overview.committedBalanceMinorUnits}
              currency={overview.currency}
              label="Currently secured in active offers"
            />
          </CardContent>
        </Card>
      </section>

      <Card className="mt-6 overflow-hidden">
        <CardHeader className="pb-5">
          <CardTitle>Your offers</CardTitle>
          <CardDescription>
            Current and historical lending offers created by you.
          </CardDescription>
        </CardHeader>
        {overview.offers.length === 0 ? (
          <EmptyState
            className="min-h-64 rounded-none border-0 border-t"
            description="Create your first offer to make funds available in the marketplace."
            title="No lending offers yet"
          />
        ) : (
          <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow className="hover:bg-slate-50/80">
                  <TableHead>Offer amount</TableHead>
                  <TableHead>Currently available</TableHead>
                  <TableHead>Loan range</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Fee rate</TableHead>
                  <TableHead>Potential repayment</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Funding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.offers.map((offer) => (
                  <TableRow key={offer.id}>
                    <TableCell>
                      <CurrencyDisplay
                        amountMinorUnits={offer.amountMinorUnits}
                        currency={offer.currency}
                      />
                    </TableCell>
                    <TableCell>
                      <CurrencyDisplay
                        amountMinorUnits={offer.availableAmountMinorUnits}
                        currency={offer.currency}
                      />
                    </TableCell>
                    <TableCell>
                      <CurrencyDisplay
                        amountMinorUnits={offer.minimumLoanAmountMinorUnits}
                        currency={offer.currency}
                      />{" "}
                      –{" "}
                      <CurrencyDisplay
                        amountMinorUnits={offer.maximumLoanAmountMinorUnits}
                        currency={offer.currency}
                      />
                    </TableCell>
                    <TableCell>{offer.durationDays} days</TableCell>
                    <TableCell>
                      {formatBasisPointsAsPercent(offer.feeRateBasisPoints)}
                    </TableCell>
                    <TableCell>
                      <CurrencyDisplay
                        amountMinorUnits={calculateEstimatedRepayment(
                          offer.amountMinorUnits,
                          offer.feeRateBasisPoints,
                        )}
                        currency={offer.currency}
                      />
                    </TableCell>
                    <TableCell>
                      {dateFormatter.format(offer.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <StatusDisplay status={offer.fundingStatus ?? "LEGACY"} />
                    </TableCell>
                    <TableCell>
                      <StatusDisplay
                        label={
                          offer.fundingStatus === "FUNDED" &&
                          offer.status === "ACTIVE"
                            ? "Available"
                            : undefined
                        }
                        status={offer.status}
                      />
                    </TableCell>
                    <TableCell>
                      {offer.fundingStatus === "FUNDED" ? (
                        <span className="text-xs text-slate-500">
                          Secured on Arc
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {offer.status === "ACTIVE" ? (
                            <OfferStatusButton
                              label="Pause"
                              offerId={offer.id}
                              status="PAUSED"
                            />
                          ) : null}
                          {offer.status === "PAUSED" ? (
                            <OfferStatusButton
                              label="Resume"
                              offerId={offer.id}
                              status="ACTIVE"
                            />
                          ) : null}
                          {offer.status !== "CLOSED" &&
                          offer.status !== "EXHAUSTED" ? (
                            <OfferStatusButton
                              label="Close"
                              offerId={offer.id}
                              status="CLOSED"
                              variant="danger"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">
                              No actions
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </main>
  );
}

function OfferStatusButton({
  label,
  offerId,
  status,
  variant = "outline",
}: {
  label: string;
  offerId: string;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
  variant?: "outline" | "danger";
}) {
  return (
    <form action={updateLendingOfferStatusAction}>
      <input name="offerId" type="hidden" value={offerId} />
      <input name="status" type="hidden" value={status} />
      <Button size="sm" type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}
