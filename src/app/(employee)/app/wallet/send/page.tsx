import type { Metadata } from "next";
import Link from "next/link";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { SendUsdcFlow } from "@/modules/arc-wallet/ui/send-usdc-flow";
import { buttonStyles } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Send USDC" };

export default async function SendUsdcPage({
  searchParams,
}: PageProps<"/app/wallet/send">) {
  await requireEmployeePage();
  const query = await searchParams;
  const transferId =
    typeof query.transfer === "string" ? query.transfer : undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        actions={
          <Link className={buttonStyles({ variant: "outline" })} href="/app">
            Back to account
          </Link>
        }
        description="Send testnet USDC from your passkey-secured Circle wallet. Every transfer is reviewed before your passkey is requested."
        eyebrow="Personal wallet · Arc Testnet"
        title="Send USDC"
      />
      <SendUsdcFlow initialTransferId={transferId} />
    </div>
  );
}
