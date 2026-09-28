import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { AccountHeader } from "@/modules/auth/ui/account-header";

export default async function EmployeeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireEmployeePage();

  return (
    <div className="min-h-screen bg-slate-50">
      <AccountHeader actor={actor} />
      {children}
    </div>
  );
}
