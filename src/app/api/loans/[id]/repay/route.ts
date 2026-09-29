import { NextResponse } from "next/server";

// Manual and partial repayments are intentionally disabled. On-chain
// repayments must use the receipt-verified repayment-intent flow.
export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      error: {
        code: "ONCHAIN_REPAYMENT_REQUIRED",
        message: "Use the loan repayment flow to repay this loan in full.",
      },
    },
    { status: 410 },
  );
}
