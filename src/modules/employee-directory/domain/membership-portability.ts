export type ExistingMembership = Readonly<{
  organizationId: string;
  role: "EMPLOYER_ADMIN" | "EMPLOYEE";
  isActive: boolean;
}>;

export function canProvisionEmployeeInOrganization(
  memberships: readonly ExistingMembership[],
  organizationId: string,
): boolean {
  const alreadyBelongsToOrganization = memberships.some(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.role === "EMPLOYEE",
  );
  if (alreadyBelongsToOrganization) return false;
  return memberships.every((membership) => !membership.isActive);
}
