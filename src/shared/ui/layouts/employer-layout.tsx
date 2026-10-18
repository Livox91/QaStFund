import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationShell } from "@/shared/ui/application-shell";
import type { NavigationItem } from "@/shared/ui/navigation";

const employerNavigation: ReadonlyArray<NavigationItem> = [
  {
    href: "/employer",
    icon: "dashboard",
    label: "Overview",
    exact: true,
    group: "Overview",
  },
  {
    href: "/employer/employees",
    icon: "employees",
    label: "Employees",
    group: "Workforce",
  },
  { href: "/employer/loans", icon: "loans", label: "Loans", group: "Lending" },
  {
    href: "/employer/monitoring",
    icon: "reports",
    label: "Monitoring",
    group: "Lending",
  },
  {
    href: "/employer/delinquency",
    icon: "reports",
    label: "Repayment exceptions",
    group: "Lending",
  },
  {
    href: "/employer/payroll",
    icon: "reports",
    label: "Payroll",
    group: "Operations",
  },
  {
    href: "/employer/policies",
    icon: "policies",
    label: "Policies",
    group: "Configuration",
  },
  {
    href: "/employer/integrations",
    icon: "integrations",
    label: "Integrations",
    group: "Configuration",
  },
  {
    href: "/employer/onboarding",
    icon: "settings",
    label: "Organization setup",
    group: "Configuration",
  },
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
