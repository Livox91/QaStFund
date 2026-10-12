export interface OperationalJobRepository {
  recordAttempt(input: {
    jobKey: string;
    subsystem: string;
    intervalSeconds: number;
    attemptedAt: Date;
  }): Promise<void>;
  recordSuccess(input: { jobKey: string; succeededAt: Date }): Promise<void>;
  recordFailure(input: {
    jobKey: string;
    failedAt: Date;
    safeErrorCode: string;
  }): Promise<void>;
}

export async function runMonitoredJob<T>(input: {
  jobKey: string;
  subsystem: string;
  intervalSeconds: number;
  safeErrorCode: string;
  repository: OperationalJobRepository;
  run: () => Promise<T>;
  now?: () => Date;
}): Promise<T> {
  const now = input.now ?? (() => new Date());
  await input.repository.recordAttempt({
    jobKey: input.jobKey,
    subsystem: input.subsystem,
    intervalSeconds: input.intervalSeconds,
    attemptedAt: now(),
  });
  try {
    const result = await input.run();
    await input.repository.recordSuccess({
      jobKey: input.jobKey,
      succeededAt: now(),
    });
    return result;
  } catch (error) {
    await input.repository.recordFailure({
      jobKey: input.jobKey,
      failedAt: now(),
      safeErrorCode: input.safeErrorCode,
    });
    throw error;
  }
}
