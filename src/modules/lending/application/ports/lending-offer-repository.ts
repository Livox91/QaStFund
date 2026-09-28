import type {
  CreateLendingOfferCommand,
  LendingMarketplaceFilters,
  LendingOfferView,
  MarketplaceLendingOffer,
} from "@/modules/lending/domain/lending-offer";

export type CreateLendingOfferRepositoryResult =
  | Readonly<{ kind: "CREATED"; offer: LendingOfferView }>
  | Readonly<{
      kind: "INSUFFICIENT_BALANCE";
      availableBalanceMinorUnits: bigint;
    }>
  | Readonly<{ kind: "MEMBERSHIP_NOT_FOUND" }>;

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
}
