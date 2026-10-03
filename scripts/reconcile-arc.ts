import { runConfiguredArcReconciliation } from "@/modules/blockchain-reconciliation/index.server";

const result = await runConfiguredArcReconciliation();
console.info(JSON.stringify(result));
