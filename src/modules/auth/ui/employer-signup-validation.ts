import {
  employerSignupSchema,
  type EmployerSignupInput,
} from "@/modules/auth/schemas/register.schema";

export type EmployerSignupField = keyof EmployerSignupInput;
export type EmployerSignupFieldErrors = Partial<
  Record<EmployerSignupField, string>
>;

export type EmployerSignupValidationResult =
  | { success: true; data: EmployerSignupInput }
  | { success: false; errors: EmployerSignupFieldErrors };

const employerSignupFields = new Set<EmployerSignupField>([
  "organizationName",
  "name",
  "email",
  "password",
  "confirmPassword",
]);

export function validateEmployerSignup(
  input: unknown,
): EmployerSignupValidationResult {
  const result = employerSignupSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };

  const errors: EmployerSignupFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      employerSignupFields.has(field as EmployerSignupField) &&
      errors[field as EmployerSignupField] === undefined
    ) {
      errors[field as EmployerSignupField] = issue.message;
    }
  }

  return { success: false, errors };
}
