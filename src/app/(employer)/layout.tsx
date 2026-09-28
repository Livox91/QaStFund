import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { AccountHeader } from "@/modules/auth/ui/account-header";

export default async function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireEmployerAdminPage();

  return (
    <div className="min-h-screen bg-slate-100">
      <AccountHeader actor={actor} />
      {children}
    </div>
  );
}
