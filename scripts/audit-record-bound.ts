export type BoundedAuditRecords<T> = Readonly<{
  records: T[];
  overflowed: boolean;
}>;

export function enforceAuditRecordBound<T>(
  records: T[],
  maximum: number,
): BoundedAuditRecords<T> {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new Error("Audit record maximum must be a positive integer.");
  }

  return {
    records: records.slice(0, maximum),
    overflowed: records.length > maximum,
  };
}
