export type BrowserPendingOperation = {
  kind: "loan_acceptance" | "repayment";
  referenceId: string;
  requestId: string;
  operationId?: string;
  transactionHash?: `0x${string}`;
  savedAt: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "employee-p2p:pending-operation:v1";

function storageKey(
  kind: BrowserPendingOperation["kind"],
  referenceId: string,
) {
  return `${KEY_PREFIX}:${kind}:${referenceId}`;
}

export function readPendingOperation(
  storage: StorageLike,
  kind: BrowserPendingOperation["kind"],
  referenceId: string,
): BrowserPendingOperation | null {
  try {
    const raw = storage.getItem(storageKey(kind, referenceId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BrowserPendingOperation>;
    if (
      value.kind !== kind ||
      value.referenceId !== referenceId ||
      typeof value.requestId !== "string" ||
      typeof value.savedAt !== "string"
    ) {
      return null;
    }
    return value as BrowserPendingOperation;
  } catch {
    return null;
  }
}

export function writePendingOperation(
  storage: StorageLike,
  operation: Omit<BrowserPendingOperation, "savedAt">,
): BrowserPendingOperation {
  const saved = { ...operation, savedAt: new Date().toISOString() };
  storage.setItem(
    storageKey(operation.kind, operation.referenceId),
    JSON.stringify(saved),
  );
  return saved;
}

export function clearPendingOperation(
  storage: StorageLike,
  kind: BrowserPendingOperation["kind"],
  referenceId: string,
) {
  storage.removeItem(storageKey(kind, referenceId));
}
