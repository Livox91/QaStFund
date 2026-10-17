import { formatUsdc } from "@/shared/money/usdc";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

type AgentLoanAction = Readonly<{
  id: string;
  action: string;
  amountBaseUnits: string | null;
  status: string;
  transactionHash: string | null;
  createdAt: string;
}>;

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

/** Employer view: what the borrower's repayment agent did on this loan, nothing more. */
export function EmployerAgentActions({
  actions,
}: {
  actions: ReadonlyArray<AgentLoanAction>;
}) {
  if (actions.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Repayment agent activity</CardTitle>
        <CardDescription>
          Actions the borrower&apos;s repayment agent took on this loan. The
          borrower&apos;s wallet balance and reasoning are private to them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {actions.map((action) => (
            <li
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
              key={action.id}
            >
              <Badge
                tone={
                  action.status === "CONFIRMED"
                    ? "success"
                    : action.status === "FAILED"
                      ? "danger"
                      : "neutral"
                }
              >
                {label(action.status)}
              </Badge>
              <span className="font-medium text-slate-900">
                {label(action.action)}
              </span>
              {action.amountBaseUnits ? (
                <span className="text-slate-600">
                  {formatUsdc(BigInt(action.amountBaseUnits))} USDC
                </span>
              ) : null}
              <span className="ml-auto text-xs text-slate-500">
                {new Date(action.createdAt).toLocaleString()}
              </span>
              {action.transactionHash ? (
                <a
                  className="text-brand text-xs font-medium underline"
                  href={`https://explorer.testnet.arc.io/tx/${action.transactionHash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  Transaction
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
