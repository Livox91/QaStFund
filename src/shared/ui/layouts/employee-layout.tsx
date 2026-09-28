import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationShell } from "@/shared/ui/application-shell";
import type { NavigationItem } from "@/shared/ui/navigation";

const employeeNavigation: ReadonlyArray<NavigationItem> = [
  { href: "/app", icon: "dashboard", label: "Dashboard", exact: true },
  { href: "/app/lending", icon: "loans", label: "My Lending" },
  {
    href: "/app/borrow",
    icon: "marketplace",
    label: "Borrow",
  },
  { href: "/profile", icon: "profile", label: "Profile" },
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
