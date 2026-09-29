import type {
  ArcWallet,
  ArcWalletChallenge,
} from "@/modules/arc-wallet/domain/arc-wallet";

export interface ArcWalletRepository {
  findForEmployee(input: {
    organizationId: string;
    userId: string;
  }): Promise<ArcWallet | null>;
  beginEnrollment(input: {
    organizationId: string;
    userId: string;
    intent: "CREATE" | "RECOVER";
  }): Promise<{ wallet: ArcWallet; action: "REGISTER" | "LOGIN" }>;
  markRegistrationComplete(input: {
    organizationId: string;
    userId: string;
  }): Promise<void>;
  createChallenge(input: {
    organizationId: string;
    userId: string;
    address: `0x${string}`;
    nonceHash: string;
    expiresAt: Date;
  }): Promise<ArcWalletChallenge>;
  findChallenge(input: {
    id: string;
    organizationId: string;
    userId: string;
  }): Promise<ArcWalletChallenge | null>;
  activateFromChallenge(input: {
    challengeId: string;
    organizationId: string;
    userId: string;
    address: `0x${string}`;
    now: Date;
  }): Promise<ArcWallet>;
}
