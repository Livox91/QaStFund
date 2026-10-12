import { z } from "zod";
import { securePasswordSchema } from "@/modules/auth/schemas/password.schema";

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: securePasswordSchema,
    organizationName: z.string().trim().min(2).max(120),
    organizationSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const employerSignupSchema = z
  .object({
    organizationName: z
      .string()
      .trim()
      .min(2, "Organization name must be at least 2 characters.")
      .max(120, "Organization name must be no more than 120 characters."),
    name: z
      .string()
      .trim()
      .min(2, "Administrator name must be at least 2 characters.")
      .max(100, "Administrator name must be no more than 100 characters."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("Enter a valid work email address.")),
    password: securePasswordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type EmployerSignupInput = z.infer<typeof employerSignupSchema>;
