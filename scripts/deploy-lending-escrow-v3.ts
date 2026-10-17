// Deploys EmployeeLendingEscrowV3 (partial repayment + repayment-agent mandate)
// through the same verified deployment script as V1.
process.env.ARC_ESCROW_CONTRACT = "EmployeeLendingEscrowV3";
await import("./deploy-lending-escrow.js");

export {};
