import { addTestFundsAction } from "@/app/(employee)/app/wallet-actions";
import type { Wallet } from "@/modules/ledger/domain/ledger";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";

const labels = {
  DEPOSIT: "Simulated Deposit",
  LOAN_DISBURSEMENT: "Loan Disbursement",
  LOAN_REPAYMENT: "Loan Repayment",
  WITHDRAWAL: "Withdrawal",
} as const;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function WalletCard({ wallet }: { wallet: Wallet }) {
  return (
    <Card className="mt-8 overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Wallet</CardTitle>
          <CardDescription>
            Your internal simulated USDC balance.
          </CardDescription>
        </div>
        {process.env.NODE_ENV !== "production" ? (
          <form action={addTestFundsAction}>
            <input name="requestId" type="hidden" value={crypto.randomUUID()} />
            <Button type="submit" variant="secondary">
              Add 100 USDC · TEST FUNDS
            </Button>
          </form>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight text-slate-950">
          <CurrencyDisplay
            amountMinorUnits={wallet.availableBalanceMinorUnits}
            currency={wallet.asset}
          />
        </p>
        <h3 className="mt-8 text-sm font-semibold text-slate-950">
          Transaction History
        </h3>
        {wallet.transactions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No wallet activity yet.</p>
        ) : (
          <ul
            className="mt-3 divide-y divide-slate-100"
            aria-label="Transaction History"
          >
            {wallet.transactions.map((transaction) => (
              <li
                className="flex items-center justify-between gap-4 py-3"
                key={transaction.id}
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {labels[transaction.type]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateFormatter.format(transaction.timestamp)}
                  </p>
                </div>
                <span
                  className={
                    transaction.direction === "IN"
                      ? "text-emerald-700"
                      : "text-slate-900"
                  }
                >
                  {transaction.direction === "IN" ? "+" : "−"}
                  <CurrencyDisplay
                    amountMinorUnits={transaction.amountMinorUnits}
                    currency={wallet.asset}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
