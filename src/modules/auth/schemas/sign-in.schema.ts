import { z } from "zod";

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  password: z
    .string()
    .min(1, "Password is required.")
    .max(128, "Password is too long."),
});

export type SignInInput = z.infer<typeof signInSchema>;
