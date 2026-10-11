import type { Metadata } from "next";
import Link from "next/link";

import { PersonalWalletAccess } from "@/modules/arc-wallet/ui/personal-wallet-access";

export const metadata: Metadata = {
  title: "Wallet access",
};

export default function WalletAccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-16 sm:px-6">
      <PersonalWalletAccess />
      <Link
        className="mt-6 text-sm font-medium text-teal-700 hover:text-teal-800"
        href="/sign-in"
      >
        Return to sign in
      </Link>
    </main>
  );
}
