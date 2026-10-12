import { z } from "zod";

export const securePasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be no more than 128 characters.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

export const passwordConfirmationSchema = z
  .object({
    password: securePasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });
