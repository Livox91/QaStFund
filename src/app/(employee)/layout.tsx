import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { CircleWalletProvider } from "@/modules/arc-wallet/ui/circle-wallet-provider";
import { EmployeeLayout } from "@/shared/ui/layouts/employee-layout";

export default async function EmployeeRouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireEmployeePage();

  return (
    <CircleWalletProvider>
      <EmployeeLayout actor={actor}>{children}</EmployeeLayout>
    </CircleWalletProvider>
  );
}
