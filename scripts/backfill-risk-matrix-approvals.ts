import { backfillRiskMatrixApprovals } from "@/lib/services/prevention-risk-legal"

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL es requerido para backfillear las aprobaciones de matrices MIPER")
}

/**
 * El cuerpo va dentro de `main()` y no en el módulo: el `package.json` no
 * declara `type: module`, así que tsx transpila estos scripts a CJS, donde el
 * `await` de nivel superior no existe. Sin el envoltorio el script aborta con
 * un TransformError de esbuild antes de abrir siquiera la conexión.
 */
async function main() {
  const result = await backfillRiskMatrixApprovals()
  console.log(JSON.stringify(result, null, 2))
  if (result.skippedNoApprover.length > 0) {
    console.warn(`${result.skippedNoApprover.length} matriz(ces) sin approvedByUserId, no se pudieron backfillear: ${result.skippedNoApprover.join(", ")}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
