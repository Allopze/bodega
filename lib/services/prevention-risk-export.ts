import ExcelJS from "exceljs"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionCapaActions, preventionRiskLegalHistory } from "@/db/schema"
import { MIPER_SHEETS } from "@/lib/prevention/miper-template"
import { riskLevelLabel } from "@/lib/prevention/risk-levels"
import { RISK_CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/risk-engine"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { getPublishedRiskMatrix, type RiskLegalAccess } from "@/lib/services/prevention-risk-legal"

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
}

/**
 * Construye el workbook MIPER completo, reutilizando el mismo vocabulario de
 * columnas (`miper-template.ts`) que el importador espera al leerlo de
 * vuelta — el ciclo Plataforma→Excel→Plataforma (§76) es un requisito
 * verificado por `lib/__tests__/prevention-risk-export-roundtrip.test.ts`.
 *
 * MR y clasificación se exportan como VALORES calculados por el servidor —
 * no como fórmulas Excel vivas: el requisito (§77) es que puedan
 * exportarse para lectura humana, "secundario" al cálculo del sistema; una
 * fórmula con referencias de celda dinámicas no cambia la fuente de verdad y
 * añade fragilidad sin necesidad real en esta iteración.
 */
export async function buildMiperWorkbook(matrixId: string, access: RiskLegalAccess) {
  const detail = await getPublishedRiskMatrix(matrixId, access)
  /* La ruta de exportación sólo exige `prevention:risk:view`, pero la hoja
   * "Programa de Trabajo" son acciones CAPA: `cphs` y `jefe_terreno` tienen
   * `prevention:risk:view` SIN `prevention:capa:view` (RBAC real,
   * modules/prevention/manifest.ts), así que emitirlas sin condición dejaba
   * bajar por el Excel lo que la UI les niega — el mismo permiso que ya
   * resguarda `getRiskDashboard`. La hoja se conserva (vacía) para no
   * cambiar la forma del libro ni romper el ciclo de reimportación. */
  const canSeeCapa = access.permissions.includes("prevention:capa:view")
  const [history, programActions] = await Promise.all([
    db.select().from(preventionRiskLegalHistory)
      .where(and(eq(preventionRiskLegalHistory.entityType, "matrix"), eq(preventionRiskLegalHistory.entityId, matrixId)))
      .orderBy(asc(preventionRiskLegalHistory.createdAt)),
    canSeeCapa
      ? db.select().from(preventionCapaActions)
        .where(and(eq(preventionCapaActions.worksiteId, detail.matrix.worksiteId), eq(preventionCapaActions.sourceType, "risk")))
        .orderBy(asc(preventionCapaActions.createdAt))
      : Promise.resolve([] as Array<typeof preventionCapaActions.$inferSelect>),
  ])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const iper = workbook.addWorksheet(MIPER_SHEETS.iper)
  iper.columns = [
    { header: "N°", key: "number", width: 6 },
    { header: "ACTIVIDAD", key: "activity", width: 24 },
    { header: "TAREA", key: "task", width: 24 },
    { header: "PUESTO DE TRABAJO", key: "position", width: 24 },
    { header: "LUGAR DE TRABAJO ESPECÍFICO", key: "specificWorkplace", width: 24 },
    { header: "F", key: "workersFemale", width: 6 },
    { header: "M", key: "workersMale", width: 6 },
    { header: "OTRO", key: "workersOther", width: 6 },
    { header: "FACTORES DE RIESGO", key: "riskFactor", width: 22 },
    { header: "RUTINARIA/NO RUTINARIA", key: "routine", width: 14 },
    { header: "PELIGRO", key: "hazard", width: 30 },
    { header: "RIESGO", key: "risk", width: 26 },
    { header: "DAÑO PROBABLE", key: "probableDamage", width: 28 },
    { header: "PROBABILIDAD", key: "probability", width: 12 },
    { header: "CONSECUENCIA", key: "consequence", width: 12 },
    { header: "MR", key: "magnitude", width: 8 },
    { header: "CLASIFICACION DEL RIESGO", key: "classification", width: 16 },
    { header: "MEDIDA DE CONTROL", key: "controlMeasure", width: 36 },
    { header: "ESTA CONTROLADO EL RIESGO", key: "controlStatus", width: 18 },
    { header: "RESPONSABLE", key: "responsible", width: 22 },
    { header: "PLAZOS", key: "deadline", width: 16 },
  ]
  const controlsByEntry = new Map<string, typeof detail.controls>()
  for (const control of detail.controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])
  const CONTROL_STATUS_LABEL: Record<string, string> = { controlled: "Sí, controlado", partial: "Parcialmente controlado", partial_immediate: "Parcialmente controlado - requiere acción inmediata" }
  detail.entries.forEach(({ entry, process, task, position }, index) => {
    const controls = controlsByEntry.get(entry.id) ?? []
    iper.addRow({
      number: index + 1,
      activity: safe(process.name),
      task: safe(task.name),
      position: safe(position.name),
      specificWorkplace: safe(entry.specificWorkplace ?? ""),
      workersFemale: entry.exposedWorkersFemale ?? "",
      workersMale: entry.exposedWorkersMale ?? "",
      workersOther: entry.exposedWorkersOther ?? "",
      riskFactor: safe(entry.riskFactor),
      routine: entry.isRoutine ? "RUTINARIA" : "NO RUTINARIA",
      hazard: safe(entry.hazard),
      risk: safe(entry.risk ?? ""),
      probableDamage: safe(entry.expectedEventOrDamage),
      probability: entry.probability ?? "",
      consequence: entry.consequence ?? "",
      magnitude: entry.riskMagnitude ?? "",
      classification: entry.riskClassification ? RISK_CLASSIFICATION_LABEL[entry.riskClassification as RiskClassification] : riskLevelLabel(entry.residualLevel),
      controlMeasure: safe(controls.map((control) => control.description).join("; ")),
      controlStatus: entry.controlStatusText ? CONTROL_STATUS_LABEL[entry.controlStatusText] : "",
      responsible: safe(entry.responsibleSnapshot),
      deadline: safe(entry.controlDeadlineText ?? ""),
    })
  })
  styleHeader(iper)
  iper.autoFilter = { from: "A1", to: "U1" }

  const controls = workbook.addWorksheet("Controles")
  controls.columns = [
    { header: "Peligro", key: "hazard", width: 30 }, { header: "Descripción", key: "description", width: 44 },
    { header: "Jerarquía", key: "hierarchy", width: 18 }, { header: "Existente", key: "existing", width: 12 },
    { header: "Crítico", key: "critical", width: 10 }, { header: "Estándar", key: "standard", width: 34 },
    { header: "Frecuencia", key: "frequency", width: 16 }, { header: "Responsable", key: "responsible", width: 22 },
    { header: "Estado", key: "status", width: 14 }, { header: "Eficacia", key: "effectiveness", width: 14 },
    { header: "Evidencia", key: "evidence", width: 30 },
  ]
  const hazardByEntry = new Map(detail.entries.map(({ entry }) => [entry.id, entry.hazard]))
  for (const control of detail.controls) controls.addRow({ hazard: safe(hazardByEntry.get(control.riskEntryId) ?? ""), description: safe(control.description), hierarchy: control.hierarchy, existing: control.isExisting ? "Sí" : "No", critical: control.isCritical ? "Sí" : "No", standard: safe(control.performanceStandard), frequency: safe(control.verificationFrequency), responsible: safe(control.responsibleSnapshot), status: control.status, effectiveness: control.effectivenessStatus, evidence: safe(control.evidenceReference) })
  styleHeader(controls)

  const modifications = workbook.addWorksheet(MIPER_SHEETS.modifications)
  modifications.columns = [
    { header: "Revisión", key: "revision", width: 10 }, { header: "Fecha", key: "date", width: 14 },
    { header: "Modificaciones", key: "changes", width: 60 }, { header: "Responsable", key: "responsible", width: 22 },
    { header: "Cargo", key: "role", width: 22 },
  ]
  history.forEach((item, index) => {
    const after = item.afterState as Record<string, unknown> | null
    modifications.addRow({
      revision: (after?.revision as string | undefined) ?? index + 1,
      date: safe(item.createdAt.slice(0, 10)),
      changes: safe((after?.changes as string | undefined) ?? item.reason),
      responsible: safe((after?.responsible as string | undefined) ?? item.actorUserId ?? ""),
      role: safe((after?.role as string | undefined) ?? ""),
    })
  })
  styleHeader(modifications)

  const criteria = workbook.addWorksheet(MIPER_SHEETS.criteria)
  criteria.addRows([
    ["Criterios de Evaluación IPER — metodología vigente al publicar esta revisión"],
    [],
    ["Probabilidad", "Valor", "Criterio"],
    ...(((detail.matrix.methodologySnapshot as { configuration?: { probability?: Array<{ label: string; value: number; criterion: string }> } } | null)?.configuration?.probability ?? [])
      .map((level) => [level.label, level.value, level.criterion])),
    [],
    ["Consecuencia", "Valor", "Criterio"],
    ...(((detail.matrix.methodologySnapshot as { configuration?: { consequence?: Array<{ label: string; value: number; criterion: string }> } } | null)?.configuration?.consequence ?? [])
      .map((level) => [level.label, level.value, level.criterion])),
    [],
    ["Clasificación", "Acción recomendada"],
    ...(((detail.matrix.methodologySnapshot as { configuration?: { bands?: Array<{ classification: string; action: string }> } } | null)?.configuration?.bands ?? [])
      .map((band) => [RISK_CLASSIFICATION_LABEL[band.classification as RiskClassification] ?? band.classification, band.action])),
  ])

  const program = workbook.addWorksheet(MIPER_SHEETS.program)
  program.columns = [
    { header: "N°", key: "number", width: 6 }, { header: "PROCESO", key: "process", width: 20 },
    { header: "ACTIVIDADES A REALIZAR (MEDIDAS DE CONTROL)", key: "activities", width: 40 },
    { header: "RESPONSABLE", key: "responsible", width: 24 }, { header: "CENTRO DE TRABAJO", key: "worksite", width: 20 },
    { header: "FECHA DE EJECUCIÓN PROGRAMADA", key: "scheduled", width: 20 },
    { header: "FECHA DE EJECUCIÓN EFECTIVA", key: "effective", width: 20 },
    { header: "INDICADOR AVANCE DEL PROGRAMA", key: "progress", width: 20 },
    { header: "ESTADO", key: "status", width: 14 },
  ]
  programActions.forEach((action, index) => program.addRow({
    number: index + 1,
    process: safe(action.sourceRef && typeof action.sourceRef === "object" ? String((action.sourceRef as Record<string, unknown>).process ?? "") : ""),
    activities: safe(action.actionDescription),
    responsible: safe(action.responsibleSnapshot ?? ""),
    worksite: safe(detail.worksiteName),
    scheduled: safe(action.targetDate),
    effective: safe(action.completedAt?.slice(0, 10) ?? ""),
    progress: action.status === "closed" || action.status === "verified" ? "100%" : action.status === "in_progress" ? "En progreso" : "",
    status: action.status,
  }))
  styleHeader(program)

  // Gobernanza de la plataforma que el Excel base no tiene (quién revisó,
  // aprobó, publicó, con qué hash) — se conservaban en el exportador anterior
  // y no hay razón para perderlas al reescribir sobre el vocabulario real.
  const approval = workbook.addWorksheet("Aprobación")
  approval.addRows([
    ["Campo", "Valor"], ["Estado", detail.matrix.status], ["Metodología", safe(JSON.stringify(detail.matrix.methodologySnapshot))],
    ["Motivo", safe(detail.matrix.revisionReason)], ["Participación", safe(detail.matrix.participationSummary)],
    ["Evidencia consulta", safe(detail.matrix.consultationEvidenceReference)], ["Revisor", detail.matrix.reviewedByUserId ?? ""],
    ["Fecha revisión", detail.matrix.reviewedAt ?? ""], ["Aprobador", detail.matrix.approvedByUserId ?? ""],
    ["Fecha aprobación", detail.matrix.approvedAt ?? ""], ["Publicador", detail.matrix.publishedByUserId ?? ""],
    ["Fecha publicación", detail.matrix.publishedAt ?? ""], ["Vigencia", detail.matrix.effectiveFrom ?? ""],
    ["Próxima revisión", detail.matrix.reviewDueAt ?? ""], ["SHA-256", detail.matrix.publishedHashSha256 ?? ""],
  ])
  styleHeader(approval)

  const triggers = workbook.addWorksheet("Revisiones")
  triggers.addRow(["Tipo", "Origen", "Descripción", "Estado", "Vence", "Resolución", "Actor", "Fecha"])
  detail.triggers.forEach((item) => triggers.addRow([item.triggerType, `${safe(item.sourceType)}:${safe(item.sourceId)}`, safe(item.description), item.status, item.dueAt, safe(item.resolution), item.resolvedByUserId ?? "", item.resolvedAt ?? ""]))
  styleHeader(triggers)

  return { workbook, detail }
}
