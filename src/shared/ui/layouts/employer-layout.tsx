import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationShell } from "@/shared/ui/application-shell";
import type { NavigationItem } from "@/shared/ui/navigation";

const employerNavigation: ReadonlyArray<NavigationItem> = [
  { href: "/employer", icon: "dashboard", label: "Overview", exact: true },
  { href: "/employer/onboarding", icon: "settings", label: "Setup" },
  { href: "/employer/employees", icon: "employees", label: "Employees" },
  { href: "/employer/loans", icon: "loans", label: "Loans" },
  { href: "/employer/monitoring", icon: "reports", label: "Monitoring" },
  { href: "/employer/policies", icon: "policies", label: "Policies" },
  { href: "/employer/reports", icon: "reports", label: "Reports" },
  {
    href: "/employer/integrations",
    icon: "integrations",
    label: "Integrations",
  },
  { href: "/employer/settings", icon: "settings", label: "Settings" },
];

export function EmployerLayout({
  actor,
  children,
}: {
  actor: AuthenticatedActor;
  children: React.ReactNode;
}) {
  return (
    <ApplicationShell
      actor={actor}
      homeHref="/employer"
      navigation={employerNavigation}
      portalLabel="Employer portal"
    >
      {children}
    </ApplicationShell>
  );
}
