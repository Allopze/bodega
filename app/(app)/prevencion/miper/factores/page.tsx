import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { listRiskFactors } from "@/lib/services/miper/risk-factors"
import { RiskFactorsAdmin } from "./risk-factors-admin"

export const metadata: Metadata = { title: "Factores de riesgo · MIPER" }

/**
 * Catálogo transversal del RE-04 (no cuelga de una faena), así que se administra
 * con su propio permiso y no pasa por el alcance por faena. La lista se lee
 * completa, con el conteo de uso de cada factor.
 */
export default async function RiskFactorsPage() {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:catalog:manage")) redirect("/forbidden")
  return <RiskFactorsAdmin factors={await listRiskFactors()} />
}
