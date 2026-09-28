import Link from "next/link";

import type { EmployeeLendingOverview } from "@/modules/lending/domain/lending-offer";
import { formatBasisPointsAsPercent } from "@/modules/lending/domain/lending-offer";
import { CreateLendingOfferForm } from "@/modules/lending/ui/create-lending-offer-form";
import { buttonStyles } from "@/shared/ui/button";
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
  minimumExpirationDate,
  overview,
}: {
  created: boolean;
  minimumExpirationDate: string;
  overview: EmployeeLendingOverview;
}) {
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/app/borrow"
          >
            Borrow Money
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

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card id="new-offer">
          <CardHeader>
            <CardTitle>Create a lending offer</CardTitle>
            <CardDescription>
              Define the amount, loan range, duration, fee, and availability
              window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateLendingOfferForm
              currency={overview.currency}
              minimumExpirationDate={minimumExpirationDate}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mock balance</CardTitle>
            <CardDescription>
              Internal development funds only. No real money or blockchain
              transaction is involved.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <BalanceItem
              amount={overview.mockBalanceMinorUnits}
              currency={overview.currency}
              label="Total mock balance"
            />
            <BalanceItem
              amount={overview.committedBalanceMinorUnits}
              currency={overview.currency}
              label="Committed to active offers"
            />
            <BalanceItem
              amount={overview.availableBalanceMinorUnits}
              currency={overview.currency}
              label="Available to offer"
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
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
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
                      {dateFormatter.format(offer.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <StatusDisplay status={offer.status} />
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
