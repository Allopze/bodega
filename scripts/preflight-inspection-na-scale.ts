import { eq } from "drizzle-orm"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { db } from "@/db"
import {
  preventionInspectionAnswers,
  preventionInspectionRuns,
  preventionInspectionTemplates,
} from "@/db/schema"
import { kindAllowsNotApplicable } from "@/lib/sst/status-options"
import type { ChecklistDefinition, FieldKind } from "@/lib/sst/types"

/**
 * Mide cuántas respuestas "No aplica" viven en ítems cuya escala NO ofrece
 * N/A (Anexo 13 Carros y el resto de las escalas sin escape).
 *
 * Hasta el fix, el formulario ofrecía "No aplica" en todos los ítems sin mirar
 * el `kind`, y `validateAnswerRow` no lo rechazaba. Como un N/A sale del
 * denominador de `compliancePercent`, cada uno de estos infló el cumplimiento
 * de su inspección — y las ya revisadas están firmadas así.
 *
 * Estrictamente de lectura: qué hacer con lo ya firmado es una decisión de
 * Prevención, no algo que una migración deba adivinar. Su salida es la que
 * decide si hace falta una fase de recálculo.
 */
export interface NaScaleConflict {
  runId: string
  runCode: string
  runStatus: string
  templateName: string
  sectionId: string
  itemId: string
  itemLabel: string
  kind: FieldKind | null
  compliancePercent: number | null
}

export interface NaScaleReport {
  ok: boolean
  totalNotApplicable: number
  conflicts: NaScaleConflict[]
  byTemplate: { templateName: string; answers: number; runs: number }[]
  byRunStatus: Record<string, number>
  /** Inspecciones ya cerradas y firmadas con un porcentaje inflado. */
  reviewedRunCodes: string[]
}

export async function findNaScaleConflicts(): Promise<NaScaleReport> {
  const rows = await db.select({
    answerId: preventionInspectionAnswers.id,
    sectionId: preventionInspectionAnswers.sectionId,
    itemId: preventionInspectionAnswers.itemId,
    itemLabel: preventionInspectionAnswers.itemLabel,
    runId: preventionInspectionRuns.id,
    runCode: preventionInspectionRuns.code,
    runStatus: preventionInspectionRuns.status,
    compliancePercent: preventionInspectionRuns.compliancePercent,
    templateName: preventionInspectionTemplates.name,
    snapshot: preventionInspectionTemplates.definitionSnapshot,
  })
    .from(preventionInspectionAnswers)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionAnswers.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .where(eq(preventionInspectionAnswers.result, "not_applicable"))

  // El `kind` no está en la respuesta: vive en el snapshot congelado de la
  // plantilla, que es justamente el cuestionario con el que se firmó.
  const kindCache = new Map<string, Map<string, FieldKind | undefined>>()
  function kindOf(templateName: string, snapshot: unknown, sectionId: string, itemId: string) {
    let byItem = kindCache.get(templateName)
    if (!byItem) {
      byItem = new Map()
      const definition = snapshot as ChecklistDefinition | null
      for (const section of definition?.sections ?? []) {
        for (const item of section.items) byItem.set(`${section.id}::${item.id}`, item.kind)
      }
      kindCache.set(templateName, byItem)
    }
    return byItem.get(`${sectionId}::${itemId}`)
  }

  const conflicts: NaScaleConflict[] = []
  for (const row of rows) {
    const kind = kindOf(row.templateName, row.snapshot, row.sectionId, row.itemId)
    // Un ítem sin `kind` en el snapshot conserva el comportamiento histórico
    // (cumple/no cumple/no aplica), así que su N/A es legítimo.
    if (kind === undefined) continue
    if (kindAllowsNotApplicable(kind)) continue
    conflicts.push({
      runId: row.runId,
      runCode: row.runCode,
      runStatus: row.runStatus,
      templateName: row.templateName,
      sectionId: row.sectionId,
      itemId: row.itemId,
      itemLabel: row.itemLabel,
      kind: kind ?? null,
      compliancePercent: row.compliancePercent,
    })
  }

  // Agrupado a mano: `Map.groupBy` typechea pero no existe en el Node que
  // corre los scripts.
  const grouped = new Map<string, NaScaleConflict[]>()
  for (const conflict of conflicts) {
    const list = grouped.get(conflict.templateName) ?? []
    list.push(conflict)
    grouped.set(conflict.templateName, list)
  }
  const byTemplate = [...grouped]
    .map(([templateName, items]) => ({
      templateName,
      answers: items.length,
      runs: new Set(items.map((item) => item.runId)).size,
    }))
    .sort((a, b) => b.answers - a.answers)

  const byRunStatus: Record<string, number> = {}
  for (const conflict of conflicts) {
    byRunStatus[conflict.runStatus] = (byRunStatus[conflict.runStatus] ?? 0) + 1
  }

  return {
    ok: conflicts.length === 0,
    totalNotApplicable: rows.length,
    conflicts,
    byTemplate,
    byRunStatus,
    reviewedRunCodes: [...new Set(
      conflicts.filter((item) => item.runStatus === "reviewed").map((item) => item.runCode),
    )].sort(),
  }
}

function getErrorCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code)
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code)
  return ""
}

async function main() {
  const report = await findNaScaleConflicts()
  // Nunca falla: es un diagnóstico, no una guarda de migración. Un exit 1 lo
  // encadenaría a `db:migrate` y bloquearía un despliegue por un dato histórico
  // que se resuelve aparte.
  console.log(JSON.stringify({
    ok: report.ok,
    totalNotApplicable: report.totalNotApplicable,
    conflictingAnswers: report.conflicts.length,
    byTemplate: report.byTemplate,
    byRunStatus: report.byRunStatus,
    reviewedRunCodes: report.reviewedRunCodes,
    // Muestra acotada: con miles de filas el JSON completo no se lee.
    sample: report.conflicts.slice(0, 20),
  }, null, 2))
}

const invokedPath = process.argv[1]
const isDirectInvocation = invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().then(
    () => process.exit(0),
    (error) => {
      if (getErrorCode(error) === "42P01") {
        console.log(JSON.stringify({
          ok: true,
          skipped: true,
          reason: "Las tablas de inspecciones aún no existen; base nueva.",
        }, null, 2))
        process.exit(0)
      }
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
