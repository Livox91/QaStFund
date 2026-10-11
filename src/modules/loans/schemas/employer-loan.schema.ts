import { z } from "zod";

export const employerLoanFilterSchema = z
  .enum(["review", "active", "repaid", "overdue", "all"])
  .catch("all");

export const employerLoanIdSchema = z.uuid();
