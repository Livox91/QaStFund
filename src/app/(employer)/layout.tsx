import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { EmployerLayout } from "@/shared/ui/layouts/employer-layout";

export default async function EmployerRouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireEmployerAdminPage();

  return <EmployerLayout actor={actor}>{children}</EmployerLayout>;
}
