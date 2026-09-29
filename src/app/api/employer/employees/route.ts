import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { formatMinorUnits } from "@/modules/ledger/api/wallet-response";
import { listEmployerEmployeesForActor } from "@/modules/policies/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const employees = await listEmployerEmployeesForActor(
      await getCurrentActor(),
    );
    return apiSuccess({
      employees: employees.map((employee) => ({
        ...employee,
        outstandingDebt: formatMinorUnits(employee.outstandingDebtMinorUnits),
        outstandingDebtMinorUnits: undefined,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
