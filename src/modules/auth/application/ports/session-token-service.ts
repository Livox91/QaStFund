export interface SessionTokenService {
  generate(): string;
  hash(token: string): string;
}
