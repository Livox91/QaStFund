export const ApplicationRole = {
  EMPLOYER_ADMIN: "EMPLOYER_ADMIN",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type ApplicationRole =
  (typeof ApplicationRole)[keyof typeof ApplicationRole];

export function getRoleHome(role: ApplicationRole): "/app" | "/employer" {
  return role === ApplicationRole.EMPLOYER_ADMIN ? "/employer" : "/app";
}
