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
    organizationName: z.string().trim().min(2).max(120),
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: securePasswordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });
