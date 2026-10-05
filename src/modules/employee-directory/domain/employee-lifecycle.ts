export function partitionEmployeesByLifecycle<
  T extends { isActive: boolean; employmentStatus: string },
>(employees: readonly T[]) {
  return employees.reduce<{ active: T[]; former: T[] }>(
    (groups, employee) => {
      if (employee.employmentStatus === "ACTIVE") {
        groups.active.push(employee);
      } else {
        groups.former.push(employee);
      }
      return groups;
    },
    { active: [], former: [] },
  );
}
