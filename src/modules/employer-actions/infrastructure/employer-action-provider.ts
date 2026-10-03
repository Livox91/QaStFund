import type {
  EmployerActionAdapter,
  EmployerActionProvider,
} from "@/modules/employer-actions/domain/employer-action";
import { MockEmployerActionAdapter } from "@/modules/employer-actions/infrastructure/mock-employer-action-adapter";

export function createEmployerActionAdapter(
  provider: EmployerActionProvider,
): EmployerActionAdapter {
  switch (provider) {
    case "mock":
      return new MockEmployerActionAdapter();
  }
}
