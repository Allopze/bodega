import { backfillRiskMatrixApprovals } from "@/lib/services/prevention-risk-legal"

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL es requerido para backfillear las aprobaciones de matrices MIPER")
}

const result = await backfillRiskMatrixApprovals()
console.log(JSON.stringify(result, null, 2))
if (result.skippedNoApprover.length > 0) {
  console.warn(`${result.skippedNoApprover.length} matriz(ces) sin approvedByUserId, no se pudieron backfillear: ${result.skippedNoApprover.join(", ")}`)
}
