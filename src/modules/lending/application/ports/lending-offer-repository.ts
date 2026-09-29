import type {
  CreateLendingOfferCommand,
  LendingOfferManagementStatus,
  LendingOfferStatus,
  LendingMarketplaceFilters,
  LendingOfferView,
  MarketplaceLendingOffer,
} from "@/modules/lending/domain/lending-offer";
import type { PolicyViolation } from "@/modules/policies/domain/lending-policy";

export type CreateLendingOfferRepositoryResult =
  | Readonly<{ kind: "CREATED"; offer: LendingOfferView }>
  | Readonly<{ kind: "MEMBERSHIP_NOT_FOUND" }>
  | Readonly<{ kind: "POLICY_VIOLATION"; violation: PolicyViolation }>;

export type ManageLendingOfferRepositoryResult =
  | Readonly<{ kind: "FOUND"; offer: LendingOfferView }>
  | Readonly<{ kind: "NOT_FOUND" }>
  | Readonly<{ kind: "NOT_OWNER" }>;

export type UpdateLendingOfferStatusRepositoryResult =
  | Readonly<{ kind: "UPDATED"; offer: LendingOfferView }>
  | Readonly<{ kind: "CONFLICT" }>;

export type EmployeeLendingRepositoryResult = Readonly<{
  currency: string;
  mockBalanceMinorUnits: bigint;
  committedBalanceMinorUnits: bigint;
  offers: ReadonlyArray<LendingOfferView>;
}>;

export type LendingMarketplaceRepositoryResult = Readonly<{
  currency: string;
  offers: ReadonlyArray<MarketplaceLendingOffer>;
}>;

export interface LendingOfferRepository {
  createForEmployee(input: {
    organizationId: string;
    userId: string;
    command: CreateLendingOfferCommand;
    now: Date;
  }): Promise<CreateLendingOfferRepositoryResult>;

  listForEmployee(input: {
    organizationId: string;
    userId: string;
    now: Date;
  }): Promise<EmployeeLendingRepositoryResult | null>;

  listMarketplace(input: {
    organizationId: string;
    userId: string;
    now: Date;
    filters: LendingMarketplaceFilters;
  }): Promise<LendingMarketplaceRepositoryResult | null>;

  listActiveForOrganization(input: {
    organizationId: string;
    userId: string;
    now: Date;
  }): Promise<ReadonlyArray<LendingOfferView> | null>;

  findForOrganization(input: {
    organizationId: string;
    userId: string;
    offerId: string;
    now: Date;
  }): Promise<LendingOfferView | null>;

  findForManagement(input: {
    organizationId: string;
    userId: string;
    offerId: string;
    now: Date;
  }): Promise<ManageLendingOfferRepositoryResult>;

  updateStatusIfCurrent(input: {
    organizationId: string;
    userId: string;
    offerId: string;
    expectedStatus: LendingOfferStatus;
    targetStatus: LendingOfferManagementStatus;
    now: Date;
  }): Promise<UpdateLendingOfferStatusRepositoryResult>;
}
