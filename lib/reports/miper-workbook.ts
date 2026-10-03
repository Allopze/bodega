/**
 * Libro Excel RE-04 de una versión de la MIPER. Hay dos modos (Task 6 de la F3):
 *
 * 1. **Sellado (por defecto).** Lo comparten la descarga sin parámetros
 *    (`app/api/prevencion/miper/[id]/export`) y el archivado automático al
 *    aprobar (`generated-documents-archive`), así que la copia archivada es el
 *    mismo libro que se descarga. La matriz sale de la foto de la versión
 *    (`detail.version.snapshot`), nunca de los datos vivos: lo que se archiva es
 *    exactamente lo que se aprobó.
 * 2. **Estado vivo (`{ liveState: true, liveSnapshot }`).** La matriz sale del
 *    estado vivo del MIPER (`buildMiperSnapshot`, lo pasa el llamador — este
 *    módulo nunca toca la base) y cada hoja de la matriz y del programa lleva la
 *    leyenda "Incluye cambios no aprobados". El nombre de archivo se distingue
 *    con el sufijo "-vivo" (`miperFilenameBase`).
 *
 * **Criterio de la hoja "Programa de Trabajo" (RE-04.1) — se cierra en la Task 6.**
 * El programa no vive en la foto sellada: meterlo en `MiperSnapshot` cambiaría su
 * forma, recalcularía `snapshot_sha256` de las versiones ya emitidas y arrastraría
 * al motor de flujo (huella firmada y diff de "cambios pendientes"), fuera del
 * alcance de esta tarea. Por eso el programa se lee del **estado vivo en ambos
 * modos** (F2 Task 9 lo admitió explícitamente) y la hoja declara su procedencia:
 *
 * - En **modo vivo** la hoja lleva la leyenda de la matriz, sin condiciones.
 * - En **modo sellado** el aviso es **condicional** (Task 6, punto 4): sólo se
 *   declara "programa al momento de la descarga" cuando el programa leído está
 *   **adelantado** respecto de la versión exportada (una versión sellada posterior
 *   existe, o el programa se revisó después de aprobarla). En el sellado puro —el
 *   de la versión vigente— no hay aviso, para no contaminar el libro aprobado.
 *
 * La matriz sigue siendo SIEMPRE lo sellado en el modo por defecto: el único dato
 * vivo del libro sellado es el programa, y va declarado. Si algún día el programa
 * debe formar parte de la evidencia legal archivada, hay que sellarlo en la foto
 * (trabajo mayor, no de esta tarea).
 */
import ExcelJS from "exceljs"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { CLASSIFICATION_CRITERIA, CLASSIFICATION_LABEL, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
import type { ProgramScheduleKind } from "@/lib/prevention/miper/schedule"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { getProgramWorkspace, type ProgramActionView, type ProgramWorkspace } from "@/lib/services/miper/program-queries"
import type { getMiperVersion } from "@/lib/services/miper/queries"
import type { MiperAccess } from "@/lib/services/miper/shared"
import { formatDate } from "@/lib/utils"

export type MiperVersionDetail = Awaited<ReturnType<typeof getMiperVersion>>

const FILL: Record<string, string> = { tolerable: "FFD9EAD3", moderate: "FFFFF2CC", important: "FFF4CCCC", intolerable: "FFC00000" }
const HEADER_FILL = "FF1F3864"
/** Marca de dato faltante en las columnas de medidas: mantiene la línea N de las tres en la medida N. */
const MISSING = "—"

function headerStyle(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } })
}

/**
 * Leyenda obligatoria del modo vivo. Sólo se agrega cuando `liveState` está
 * activo: el libro por defecto (sellado) nunca la lleva. El nombre de archivo
 * usa el sufijo `-vivo` para que una descarga viva no se confunda con la sellada
 * (misma faena, mismo período, misma versión).
 */
export const LIVE_LEGEND = "Incluye cambios no aprobados"

export type MiperWorkbookOptions = {
  /** Arma el libro desde el estado vivo. Por defecto, sellado. */
  liveState?: boolean
  /**
   * Estado vivo de la matriz (salida de `buildMiperSnapshot`). Lo aporta el
   * llamador; este módulo nunca lee la base. Sólo se usa con `liveState`.
   */
  liveSnapshot?: MiperSnapshot
}

export function miperFilenameBase(detail: MiperVersionDetail, options: { liveState?: boolean } = {}) {
  const base = `RE-04-MIPER-${detail.worksiteCode}-${detail.version.period ?? "sin-periodo"}-v${detail.version.versionNumber}`
  return options.liveState ? `${base}-vivo` : base
}

const PROGRAM_FREQUENCY_LABEL: Record<ProgramScheduleKind, string> = {
  once: "Única vez", monthly: "Mensual", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual",
}

/**
 * Permiso de lectura para la consulta del programa hecha desde el libro. Quien
 * llega acá (descarga o cron de archivado) ya autorizó la versión sellada antes
 * de armar el libro; este acceso de sistema sólo vuelve a leer el programa, no
 * amplía lo que la persona puede ver. Mismo patrón que `getMiperVersionForArchive`.
 */
const PROGRAM_READ_ACCESS: MiperAccess = {
  userId: "system:miper-workbook",
  scope: { mode: "all", ids: [] },
  permissions: ["prevention:risk:view"],
}

/**
 * DECISIÓN del Step 1 de la Task 9 (F2), reafirmada por la Task 6 (F3): el
 * programa de la hoja sale de las **filas vivas** por `matrixId` al momento de
 * armar el libro, no del `snapshot`, en ambos modos.
 *
 * El `snapshot` sellado guarda encabezado, filas y medidas, pero no el programa
 * RE-04.1. Meterlo ahí cambiaría la forma de `MiperSnapshot`, recalcularía
 * `snapshot_sha256` de las versiones ya emitidas y arrastraría al motor de flujo
 * —toca la huella firmada y el diff de "cambios pendientes"—, algo fuera del
 * alcance de esta tarea. El plan admite explícitamente la alternativa: leerlo al
 * momento de armar el libro y declararlo en la hoja ("programa al momento de la
 * descarga"). Lo que la Task 6 cierra es el **cómo se declara**: el aviso de la
 * hoja RE-04.1 es condicional en el sellado (ver `addProgramSheet`) y se vuelve
 * la leyenda de la matriz en el modo vivo.
 *
 * La lectura es best-effort: si falla, la hoja RE-04.1 queda vacía con su
 * mensaje. Un problema al leer el programa no debe tumbar la descarga del RE-04
 * sellado (la ruta convierte cualquier error en un 404 "no encontrada", que para
 * un documento ya aprobado sería peor que una hoja auxiliar vacía).
 */
async function readLiveProgram(matrixId: string): Promise<ProgramWorkspace | null> {
  try {
    return await getProgramWorkspace(matrixId, PROGRAM_READ_ACCESS)
  } catch {
    return null
  }
}

/**
 * ¿El programa vivo está adelantado respecto de la versión sellada que se
 * exporta? Es la condición del aviso de la hoja RE-04.1 en modo sellado (Task 6,
 * punto 4). Dos señales, en orden: el programa revisado en una versión posterior
 * a la aprobada; o, si no hay fecha, la existencia de una versión sellada más
 * nueva que la exportada. En el sellado puro (versión vigente, sin programa
 * posterior) devuelve `false` y la hoja no lleva aviso.
 */
function programIsAheadOfVersion(detail: MiperVersionDetail, workspace: ProgramWorkspace | null): boolean {
  const reviewed = workspace?.program?.lastReviewedOn ?? null
  if (reviewed && detail.version.approvedAt) return reviewed > detail.version.approvedAt
  const latest = detail.versions.reduce((max, version) => Math.max(max, version.versionNumber), detail.version.versionNumber)
  return latest > detail.version.versionNumber
}

function programScheduleLabel(action: ProgramActionView): string {
  return action.scheduleKind === "once"
    ? formatDate(action.startsOn)
    : `${PROGRAM_FREQUENCY_LABEL[action.scheduleKind]} (desde ${formatDate(action.startsOn)})`
}

/** Fechas efectivas de las ocurrencias realizadas, una por línea. */
function programEffectiveDates(action: ProgramActionView): string {
  return action.occurrences
    .filter((occurrence) => occurrence.outcome === "done" && occurrence.effectiveOn)
    .map((occurrence) => formatDate(occurrence.effectiveOn as string))
    .join("\n")
}

/**
 * Avance derivado (§7.5): realizadas ÷ planificadas, con las fuera de plazo
 * marcadas junto a las incumplidas y las vencidas. Nunca se ingresa a mano.
 */
function programProgressLabel(progress: ProgramProgress): string {
  if (progress.planned === 0) return progress.failed > 0 ? `${progress.failed} incumplida(s) · 0 planificadas` : "—"
  const parts = [`${progress.done}/${progress.planned} (${Math.round((progress.done / progress.planned) * 100)}%)`]
  if (progress.late > 0) parts.push(`${progress.late} fuera de plazo`)
  if (progress.failed > 0) parts.push(`${progress.failed} incumplida${progress.failed === 1 ? "" : "s"}`)
  if (progress.overdue > 0) parts.push(`${progress.overdue} vencida${progress.overdue === 1 ? "" : "s"}`)
  return parts.join(" · ")
}

const PROGRAM_COLUMNS = [
  "N°", "PROCESO", "ACTIVIDAD / MEDIDA", "RESPONSABLE", "CENTRO DE TRABAJO",
  "FRECUENCIA / FECHA PROGRAMADA", "FECHA DE EJECUCIÓN EFECTIVA", "AVANCE",
]

/**
 * Hoja "Programa de Trabajo" (RE-04.1). Siempre presente —el formato RE-04 la
 * espera—: si la versión no tiene programa se agrega vacía con su mensaje. El
 * encabezado usa los datos del programa cuando existen y cae a la foto sellada
 * para los campos de empresa (período, razón social, RUT, dirección y
 * representante), por lo que incluso sin programa queda identificable.
 *
 * El aviso de la fila 2 es condicional (Task 6, punto 4): en modo vivo es la
 * leyenda de la matriz; en sellado sólo aparece cuando el programa leído está
 * adelantado respecto de la versión exportada; en el sellado puro queda vacío.
 */
function addProgramSheet(workbook: ExcelJS.Workbook, detail: MiperVersionDetail, snapshot: MiperSnapshot, workspace: ProgramWorkspace | null, liveState: boolean) {
  const h = snapshot.header
  const program = workspace?.program ?? null
  const sheet = workbook.addWorksheet("Programa de Trabajo", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "13:13" },
  })
  sheet.mergeCells("A1:H1")
  sheet.getCell("A1").value = "Programa de Trabajo Preventivo (RE-04.1)"
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.mergeCells("A2:H2")
  sheet.getCell("A2").value = liveState
    ? `${LIVE_LEGEND}: el programa se lee del estado vivo del MIPER.`
    : programIsAheadOfVersion(detail, workspace)
      ? "Programa al momento de la descarga: se lee del estado vivo y puede incluir cambios posteriores a la aprobación de la versión."
      : ""
  sheet.getCell("A2").font = { italic: true, size: 9 }

  const elaboratedOn = program?.elaboratedOn ?? h.elaboratedOn
  const fields: Array<[string, ExcelJS.CellValue]> = [
    ["PERÍODO", program ? program.period : (h.period ?? "")],
    ["RAZÓN SOCIAL", safe(program?.companyName ?? h.companyName ?? "")],
    ["RUT EMPLEADOR", safe(program?.companyRut ?? h.companyRut ?? "")],
    ["DIRECCIÓN / COMUNA", safe([program?.companyAddress ?? h.companyAddress, program?.companyCommune ?? h.companyCommune].filter(Boolean).join(", "))],
    // Nunca "representante legal": quien responde por la faena es el administrador
    // de contrato (§4.8), también en el RE-04.1 (mismo rótulo que la hoja RE-04).
    ["REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)", safe(program?.siteRepresentativeName ?? h.siteRepresentativeName ?? "")],
    ["FECHA DE ELABORACIÓN", elaboratedOn ? formatDate(elaboratedOn) : ""],
    ["N° DE CENTROS DE TRABAJO", program ? program.worksiteCount : ""],
    ["FECHA DE ÚLTIMA REVISIÓN", program?.lastReviewedOn ? formatDate(program.lastReviewedOn) : ""],
    ["ENCARGADO DEL PROGRAMA", safe(program?.programManagerName ?? "")],
  ]
  fields.forEach(([label, value], index) => {
    const rowNumber = 3 + index
    sheet.mergeCells(`A${rowNumber}:C${rowNumber}`)
    sheet.mergeCells(`D${rowNumber}:H${rowNumber}`)
    const row = sheet.getRow(rowNumber)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(4).value = value
  })

  const top = sheet.getRow(13)
  PROGRAM_COLUMNS.forEach((label, index) => { top.getCell(index + 1).value = label })
  headerStyle(top)

  const actions = (workspace?.actions ?? []).filter((action) => action.status === "active")
  if (actions.length === 0) {
    sheet.mergeCells("A14:H14")
    sheet.getCell("A14").value = "Esta versión no tiene actividades del Programa de Trabajo (RE-04.1) registradas."
    sheet.getCell("A14").font = { italic: true }
  }
  for (const action of actions) {
    const row = sheet.addRow([
      action.actionNumber,
      safe(action.processName ?? ""),
      safe(action.description),
      safe(action.responsibleName ?? ""),
      safe(action.locationLabel ?? program?.worksiteName ?? detail.worksiteName),
      safe(programScheduleLabel(action)),
      safe(programEffectiveDates(action)),
      safe(programProgressLabel(action.progress)),
    ])
    row.alignment = { vertical: "top", wrapText: true }
  }

  const widths = [5, 22, 40, 24, 22, 26, 20, 34]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.views = [{ state: "frozen", ySplit: 13 }]
}

/**
 * `program` es la costura de pruebas: si se omite, el libro lee el programa vivo
 * por `matrixId` (producción, en ambos modos); si se pasa `null` o un workspace,
 * se usa tal cual (tests, sin tocar la base).
 *
 * `options.liveState` cambia la fuente de la matriz: por defecto (sellado) sale
 * de `detail.version.snapshot`; con `liveState` sale de `options.liveSnapshot`
 * (el estado vivo) y el libro lleva la leyenda "Incluye cambios no aprobados".
 */
export async function buildMiperWorkbook(detail: MiperVersionDetail, program?: ProgramWorkspace | null, options: MiperWorkbookOptions = {}) {
  const liveState = options.liveState === true
  const snapshot = liveState && options.liveSnapshot ? options.liveSnapshot : (detail.version.snapshot as MiperSnapshot)
  const h = snapshot.header
  const programWorkspace = program === undefined ? await readLiveProgram(detail.version.matrixId) : program
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma CHOME"

  const sheet = workbook.addWorksheet("RE-04 IPER", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "12:13" },
  })
  sheet.mergeCells("A1:U1")
  sheet.getCell("A1").value = liveState
    ? `Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER) — ${LIVE_LEGEND}`
    : "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"
  sheet.getCell("A1").font = { bold: true, size: 14 }
  // `safe()` devuelve el valor ya neutralizado (string | number | boolean):
  // las columnas de valor no son sólo texto.
  const headerRows: Array<[string, ExcelJS.CellValue, string, ExcelJS.CellValue]> = [
    ["CÓDIGO IPER", safe(h.iperCode ?? "RE-04"), "FECHA ELABORACIÓN", h.elaboratedOn ? formatDate(h.elaboratedOn) : ""],
    ["RAZÓN SOCIAL", safe(h.companyName ?? ""), "FECHA ACTUALIZACIÓN", h.updatedOn ? formatDate(h.updatedOn) : ""],
    ["RUT EMPLEADOR", safe(h.companyRut ?? ""), "PERÍODO / VERSIÓN", `${h.period ?? ""} · v${detail.version.versionNumber}`],
    ["DIRECCIÓN / COMUNA", safe([h.companyAddress, h.companyCommune].filter(Boolean).join(", ")), "N° DE ADHERENTE", safe(h.adherentNumber ?? "")],
    ["ACTIVIDAD ECONÓMICA PRINCIPAL", safe(h.economicActivity ?? ""), "NOMBRE CENTRO DE TRABAJO", safe(h.worksiteName ?? detail.worksiteName)],
    ["REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)", safe(h.siteRepresentativeName ?? ""), "N° TRABAJADORES (TOTAL / H / M / OTRO)", `${h.headcountTotal ?? ""} / ${h.headcountMale ?? ""} / ${h.headcountFemale ?? ""} / ${h.headcountOther ?? ""}`],
    ["NOMBRE QUIEN ELABORÓ", safe(detail.version.elaboratedByName), "NOMBRE QUIEN REVISÓ", safe(detail.version.technicalReviewerName)],
    ["NOMBRE QUIEN APROBÓ (LEGAL Y RRHH)", safe(detail.version.approverName), "FECHA DE APROBACIÓN", formatDate(detail.version.approvedAt)],
  ]
  headerRows.forEach(([labelA, valueA, labelB, valueB], index) => {
    const row = sheet.getRow(3 + index)
    row.getCell(1).value = labelA; row.getCell(4).value = valueA
    row.getCell(11).value = labelB; row.getCell(14).value = valueB
    row.getCell(1).font = { bold: true }; row.getCell(11).font = { bold: true }
  })

  const top = sheet.getRow(12)
  const labels = ["N°", "ACTIVIDAD", "TAREA", "PUESTO DE TRABAJO", "LUGAR DE TRABAJO ESPECÍFICO", "N° DE TRABAJADORES", "", "", "FACTORES DE RIESGO", "RUTINARIA / NO RUTINARIA", "PELIGRO", "RIESGO", "DAÑO PROBABLE", "EVALUACIÓN DEL RIESGO", "", "", "", "MEDIDA DE CONTROL", "¿ESTÁ CONTROLADO EL RIESGO?", "RESPONSABLE", "PLAZOS"]
  labels.forEach((label, index) => { top.getCell(index + 1).value = label })
  const sub = sheet.getRow(13)
  ;[[6, "F"], [7, "M"], [8, "OTRO"], [14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]].forEach(([col, label]) => { sub.getCell(col as number).value = label as string })
  sheet.mergeCells("F12:H12"); sheet.mergeCells("N12:Q12")
  for (const col of [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 18, 19, 20, 21]) sheet.mergeCells(12, col, 13, col)
  headerStyle(top); headerStyle(sub)

  for (const entry of snapshot.entries) {
    // Fase C: una línea por medida en MEDIDA, RESPONSABLE y PLAZOS, para que la
    // línea N de las tres sea la misma medida. Antes RESPONSABLE se deduplicaba y
    // PLAZOS descartaba las vacías, y las columnas se desalineaban. PLAZOS es la
    // frecuencia de verificación de una medida existente o la fecha de una por
    // implementar (D5). Una foto anterior a la Fase C no trae `isExisting`: por
    // implementar, la regla de entonces.
    const lines = entry.controls.map((control) => ({
      measure: `${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description.replace(/\s*\n\s*/g, " ")}`,
      responsible: control.responsibleName ?? MISSING,
      deadline: (control.isExisting ?? false)
        ? control.verificationFrequency ?? MISSING
        : control.dueDate ? formatDate(control.dueDate) : MISSING,
    }))
    const measures = lines.map((line) => line.measure).join("\n")
    const responsible = lines.map((line) => line.responsible).join("\n")
    const deadlines = lines.map((line) => line.deadline).join("\n")
    const row = sheet.addRow([
      entry.rowNumber, safe(entry.activity ?? ""), safe(entry.task ?? ""), safe(entry.position ?? ""), safe(entry.location ?? ""),
      entry.exposedFemale, entry.exposedMale, entry.exposedOther, safe(entry.riskFactor ?? ""),
      entry.isRoutine === null ? "" : entry.isRoutine ? "Rutinaria" : "No rutinaria",
      safe(entry.hazard ?? ""), safe(entry.risk ?? ""), safe(entry.probableDamage ?? ""),
      entry.probability ?? "", entry.consequence ?? "", entry.magnitude ?? "",
      entry.classification ? CLASSIFICATION_LABEL[entry.classification].toUpperCase() : "",
      safe(measures), entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "", safe(responsible), safe(deadlines),
    ])
    row.alignment = { vertical: "top", wrapText: true }
    if (entry.classification) {
      const cell = row.getCell(17)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[entry.classification]! } }
      cell.font = { bold: true, color: { argb: entry.classification === "intolerable" ? "FFFFFFFF" : "FF000000" } }
    }
  }
  const widths = [5, 22, 22, 20, 20, 5, 5, 6, 16, 13, 28, 24, 26, 8, 8, 6, 14, 48, 14, 20, 12]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 13 }]

  const changes = workbook.addWorksheet("Modificaciones")
  headerStyle(changes.addRow(["Revisión", "Fecha", "Modificaciones", "Responsable", "Aprobó"]))
  for (const version of detail.versions) changes.addRow([version.versionNumber, formatDate(version.approvedAt), safe(version.changeSummary), safe(version.elaboratedByName), safe(version.approverName)])
  changes.columns = [{ width: 10 }, { width: 14 }, { width: 70 }, { width: 28 }, { width: 28 }]

  const criteria = workbook.addWorksheet("Criterios de Evaluación IPER")
  headerStyle(criteria.addRow(["PROBABILIDAD", "VALOR", "CRITERIO"]))
  for (const level of PROBABILITY_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CONSECUENCIA", "VALOR", "CRITERIO"]))
  for (const level of CONSEQUENCE_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CLASIFICACIÓN", "MR", "CRITERIO"]))
  const bandMr: Record<string, string> = { tolerable: "1 - 2", moderate: "4", important: "8", intolerable: "16" }
  for (const classification of RISK_CLASSIFICATIONS) criteria.addRow([CLASSIFICATION_LABEL[classification].toUpperCase(), bandMr[classification], CLASSIFICATION_CRITERIA[classification]])
  criteria.columns = [{ width: 30 }, { width: 10 }, { width: 110 }]
  criteria.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true } })

  addProgramSheet(workbook, detail, snapshot, programWorkspace, liveState)

  return workbook
}
