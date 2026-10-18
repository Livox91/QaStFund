import type { NextRequest } from "next/server";
import { z } from "zod";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  createDraftSalarySlipForActor,
  listSalarySlipsForActor,
} from "@/modules/payroll-integration/application/salary-slips";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z
  .object({
    employeeMappingId: z.uuid(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "Period end must not precede period start.",
  });

function serialize(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

export async function GET(request: NextRequest) {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(actor, "payroll.salary-slip.list", "sensitive");
    const parsed = inputSchema.safeParse({
      employeeMappingId: request.nextUrl.searchParams.get("employeeMappingId"),
      periodStart: request.nextUrl.searchParams.get("periodStart"),
      periodEnd: request.nextUrl.searchParams.get("periodEnd"),
    });
    if (!parsed.success)
      throw new ApplicationError(
        "INVALID_PAYROLL_PERIOD",
        "Invalid payroll period.",
        400,
      );
    return apiSuccess({
      salarySlips: serialize(
        await listSalarySlipsForActor(
          actor,
          parsed.data.employeeMappingId,
          parsed.data.periodStart,
          parsed.data.periodEnd,
        ),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "payroll.salary-slip.create",
      "sensitive",
    );
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApplicationError(
        "INVALID_PAYROLL_PERIOD",
        "Invalid payroll period.",
        400,
      );
    const evidence = await createDraftSalarySlipForActor(
      actor,
      parsed.data.employeeMappingId,
      parsed.data.periodStart,
      parsed.data.periodEnd,
    );
    return apiSuccess(
      {
        evidence: serialize({
          externalId: evidence.externalSalarySlipId,
          grossPayMinorUnits: evidence.grossPayMinorUnits,
          netPayMinorUnits: evidence.netPayMinorUnits,
          currency: evidence.currency,
          documentStatus: evidence.documentStatus,
        }),
      },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
