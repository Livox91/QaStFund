import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { EmployeeLayout } from "@/shared/ui/layouts/employee-layout";

export default async function EmployeeRouteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireEmployeePage();

  return <EmployeeLayout actor={actor}>{children}</EmployeeLayout>;
}
