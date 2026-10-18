import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationShell } from "@/shared/ui/application-shell";
import type { NavigationItem } from "@/shared/ui/navigation";

const employeeNavigation: ReadonlyArray<NavigationItem> = [
  {
    href: "/app",
    icon: "dashboard",
    label: "Dashboard",
    exact: true,
    group: "Overview",
  },
  {
    href: "/app/borrow",
    icon: "marketplace",
    label: "Marketplace",
    group: "Borrow & lend",
  },
  {
    href: "/app/lending",
    icon: "loans",
    label: "My lending",
    group: "Borrow & lend",
  },
  {
    href: "/app/agent",
    icon: "reports",
    label: "Repayment agent",
    group: "Repayments",
  },
  {
    href: "/app/onboarding",
    icon: "settings",
    label: "Account setup",
    group: "Account",
  },
  { href: "/profile", icon: "profile", label: "Profile", group: "Account" },
];

export function EmployeeLayout({
  actor,
  children,
}: {
  actor: AuthenticatedActor;
  children: React.ReactNode;
}) {
  return (
    <ApplicationShell
      actor={actor}
      homeHref="/app"
      navigation={employeeNavigation}
      portalLabel="Employee portal"
    >
      {children}
    </ApplicationShell>
  );
}
