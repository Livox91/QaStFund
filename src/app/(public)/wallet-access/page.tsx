import type { Metadata } from "next";
import Link from "next/link";

import { PersonalWalletAccess } from "@/modules/arc-wallet/ui/personal-wallet-access";
import { ProductBrand } from "@/shared/ui/brand-mark";

export const metadata: Metadata = {
  title: "Wallet access",
};

export default function WalletAccessPage() {
  return (
    <main className="bg-canvas flex min-h-screen flex-col items-center justify-center px-4 py-16 sm:px-6">
      <ProductBrand className="mb-8" subtitle="Secure Arc wallet access" />
      <PersonalWalletAccess />
      <Link
        className="text-brand hover:text-brand mt-6 text-sm font-medium"
        href="/sign-in"
      >
        Return to sign in
      </Link>
    </main>
  );
}
