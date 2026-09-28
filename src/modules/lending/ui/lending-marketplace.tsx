import Link from "next/link";

import {
  calculateEstimatedRepayment,
  formatBasisPointsAsPercent,
  getCurrentlyBorrowableMaximum,
  LendingMarketplaceSort,
  type LendingMarketplace,
} from "@/modules/lending/domain/lending-offer";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";
import { Field, Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function minorUnitsToInputValue(amount?: bigint): string {
  if (amount === undefined) return "";

  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, "0");
  return fraction === "00" ? whole.toString() : `${whole}.${fraction}`;
}

export function LendingMarketplaceView({
  marketplace,
}: {
  marketplace: LendingMarketplace;
}) {
  const { filters } = marketplace;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ variant: "outline" })}
            href="/app/lending"
          >
            My Lending
          </Link>
        }
        description="Discover active coworker offers without exposing unnecessary personal information."
        eyebrow="Employee portal"
        title="Borrow Money"
      />

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Find an offer</CardTitle>
          <CardDescription>
            Filter by the amount you need and the longest repayment duration you
            prefer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/app/borrow"
            className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_auto_auto]"
            method="get"
          >
            <Field
              hint={`Desired amount in ${marketplace.currency}.`}
              htmlFor="amount"
              label="Amount"
            >
              <Input
                defaultValue={minorUnitsToInputValue(filters.amountMinorUnits)}
                id="amount"
                inputMode="decimal"
                min="0.01"
                name="amount"
                placeholder="250.00"
                step="0.01"
                type="number"
              />
            </Field>
            <Field
              hint="Show offers at or below this term."
              htmlFor="duration"
              label="Maximum duration"
            >
              <Input
                defaultValue={filters.maximumDurationDays?.toString() ?? ""}
                id="duration"
                inputMode="numeric"
                max="365"
                min="1"
                name="duration"
                placeholder="30 days"
                step="1"
                type="number"
              />
            </Field>
            <Field htmlFor="sort" label="Sort by">
              <select
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-950 shadow-sm outline-none focus:border-teal-600 focus:ring-3 focus:ring-teal-100"
                defaultValue={filters.sort}
                id="sort"
                name="sort"
              >
                <option value={LendingMarketplaceSort.LOWEST_FEE}>
                  Lowest fee
                </option>
                <option value={LendingMarketplaceSort.MOST_AVAILABLE}>
                  Most available
                </option>
                <option value={LendingMarketplaceSort.SHORTEST_DURATION}>
                  Shortest duration
                </option>
                <option value={LendingMarketplaceSort.EXPIRING_SOON}>
                  Expiring soon
                </option>
              </select>
            </Field>
            <Button type="submit">Apply</Button>
            <Link
              className={buttonStyles({ variant: "ghost" })}
              href="/app/borrow"
            >
              Clear
            </Link>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {marketplace.offers.length}{" "}
          {marketplace.offers.length === 1 ? "offer" : "offers"} available
        </p>
        <Badge tone="success">Verified employees only</Badge>
      </div>

      {marketplace.offers.length === 0 ? (
        <EmptyState
          className="mt-5"
          description="Try adjusting your amount or duration. Expired, inactive, personal, and other-organization offers are always excluded."
          title="No matching offers"
        />
      ) : (
        <section
          aria-label="Available lending offers"
          className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {marketplace.offers.map((offer) => {
            const maximumBorrowable = getCurrentlyBorrowableMaximum(offer);
            const estimatedPrincipal =
              filters.amountMinorUnits ?? maximumBorrowable;
            const estimatedRepayment = calculateEstimatedRepayment(
              estimatedPrincipal,
              offer.feeRateBasisPoints,
            );

            return (
              <Card key={offer.id} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Lending offer</CardTitle>
                      <CardDescription>
                        Expires {dateFormatter.format(offer.expiresAt)}
                      </CardDescription>
                    </div>
                    <Badge tone="accent">Coworker</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl bg-slate-950 p-4 text-white">
                    <p className="text-xs font-medium text-slate-300">
                      Amount available
                    </p>
                    <CurrencyDisplay
                      amountMinorUnits={offer.availableAmountMinorUnits}
                      className="mt-2 block text-2xl font-semibold text-white"
                      currency={offer.currency}
                    />
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                    <div>
                      <dt className="text-xs text-slate-400">Amount range</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950">
                        <CurrencyDisplay
                          amountMinorUnits={offer.minimumLoanAmountMinorUnits}
                          currency={offer.currency}
                        />{" "}
                        –{" "}
                        <CurrencyDisplay
                          amountMinorUnits={maximumBorrowable}
                          currency={offer.currency}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Duration</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950">
                        {offer.durationDays} days
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Interest / fee</dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950">
                        {formatBasisPointsAsPercent(offer.feeRateBasisPoints)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Estimated repayment
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950">
                        <CurrencyDisplay
                          amountMinorUnits={estimatedRepayment}
                          currency={offer.currency}
                        />
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">
                    Estimate based on{" "}
                    {filters.amountMinorUnits
                      ? "your desired amount"
                      : "the current maximum amount"}
                    . Final terms are shown before confirmation.
                  </p>
                </CardContent>
                <CardFooter>
                  <Link
                    className={buttonStyles({ className: "w-full" })}
                    href={`/app/borrow/${offer.id}${filters.amountMinorUnits ? `?amount=${minorUnitsToInputValue(filters.amountMinorUnits)}` : ""}`}
                  >
                    Review offer
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </section>
      )}
    </main>
  );
}
