export interface LoanLifecycleRepository {
  markOverdue(input: {
    organizationId: string;
    actorUserId: string;
    now: Date;
  }): Promise<number>;
}
