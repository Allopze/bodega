import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { sstEvaluations } from "@/db/schema/sst"
import { getDefinition } from "@/lib/sst/definitions/index"
import { getApplicableItems, sectionAppliesToEvaluatorRole } from "@/lib/sst/checklist"

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
