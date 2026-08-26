import { backfillRiskClassification } from "@/lib/services/prevention-risk-legal"

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL es requerido para backfillear la clasificación de riesgo MIPER")
}

const result = await backfillRiskClassification()
console.log(JSON.stringify(result, null, 2))
if (result.unresolved.length > 0) {
  console.warn(`${result.unresolved.length} entrada(s) con residualLevel no normalizable, quedaron sin clasificación: ${result.unresolved.join(", ")}`)
}
