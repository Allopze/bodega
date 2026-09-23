import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { sstEvaluations } from "@/db/schema/sst"
import { getDefinition } from "@/lib/sst/definitions/index"
import { getApplicableItems, getMandatoryItems, sectionAppliesToEvaluatorRole } from "@/lib/sst/checklist"

export const SECTIONS_EXCLUDED_FROM_PERCENTAGE: Record<string, string[]> = {
  trabajador_nuevo: ["competencias_operacionales"],
}

export async function assertEditable(evaluationId: string, tx?: Tx): Promise<void> {
  const client = tx ?? db
  const [row] = await client.select({ estado: sstEvaluations.estado }).from(sstEvaluations).where(eq(sstEvaluations.id, evaluationId)).limit(1)
  if (!row) throw new Error("Evaluación no encontrada.")
  if (row.estado === "cerrado") throw new Error("Esta evaluación está cerrada y no puede ser modificada. Las actas cerradas son inmutables por requerimiento legal (DS N°44/2024).")
}

export function getEvaluationApplicableItems(definition: ReturnType<typeof getDefinition>, cargoKeys: string[], evaluatorRole: string | null) {
  const sectionById = new Map(definition.sections.map((s) => [s.id, s]))
  return getApplicableItems(definition, cargoKeys).filter(({ seccionId }) => {
    const section = sectionById.get(seccionId)
    if (!section) return false
    return sectionAppliesToEvaluatorRole(section, evaluatorRole)
  })
}

/**
 * Igual que `getEvaluationApplicableItems`, pero para el chequeo de "falta
 * responder" del cierre: parte de `getMandatoryItems` en vez de
 * `getApplicableItems`, así que incluye las secciones marcadas
 * `requiresCompletion` aunque no puntúen (RE-28). El filtro por rol de
 * evaluador es el mismo: el conductor líder sólo ve/responde su Punto 3.
 */
export function getEvaluationMandatoryItems(definition: ReturnType<typeof getDefinition>, cargoKeys: string[], evaluatorRole: string | null) {
  const sectionById = new Map(definition.sections.map((s) => [s.id, s]))
  return getMandatoryItems(definition, cargoKeys).filter(({ seccionId }) => {
    const section = sectionById.get(seccionId)
    if (!section) return false
    return sectionAppliesToEvaluatorRole(section, evaluatorRole)
  })
}
