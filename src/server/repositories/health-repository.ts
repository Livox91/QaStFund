export interface HealthRepository {
  ping(): Promise<void>;
}
