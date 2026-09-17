/**
 * Renderizador ExcelJS del formato RE-36 (Programa de Trabajo Preventivo
 * SG-SST): convierte el modelo puro `PdtpRe36Document`
 * (`lib/services/pdtp/re36-document.ts`) en el libro Excel con el layout que
 * hoy firma Legal y recibe el mandante — ver
 * `PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md` §2 para la anatomía original.
 *
 * Esta tarea (1.6) SOLO renderiza: no toca la base de datos, no reconsulta
 * nada — el documento ya viene resuelto. La tarea 1.7 la enchufa a la ruta de
 * descarga.
 *
 * Saneo: el modelo entrega los textos crudos a propósito (ver JSDoc de
 * `PdtpRe36Document`). Cada texto que este módulo escribe en una celda pasa
 * por `sanitizeCell` (`lib/reports/export-module/excel-builder.ts`) antes de
 * asignarse. El libro se serializa con `workbook.xlsx.writeBuffer()` — **no**
 * con `xlsxToBase64`, que vuelve a sanear cada celda del libro completo y
 * convertiría las fórmulas de los totales (`SUM`, `IFERROR`, `AVERAGE`) en
 * texto literal (les antepondría una comilla al ver el `=` inicial de la
 * fórmula serializada), rompiendo el recálculo.
 */
import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { safeWorksheetName, sanitizeCell } from "@/lib/reports/export-module/excel-builder"
import type { PdtpRe36Document, PdtpRe36Sheet } from "@/lib/services/pdtp/re36-document"

/**
 * Filas/columnas fijas del layout, para no repetir números mágicos. Todo lo
 * demás (última fila de datos, filas de totales, inicio del bloque de firmas,
 * etc.) se calcula a partir de estas constantes y de `rows.length` de cada
 * hoja — nunca un número fijo, que fue precisamente uno de los defectos del
 * Excel original (§2.5: "los rangos son fijos (14:102): si se insertan filas
 * fuera del rango, los totales dejan de contarlas").
 */
export const RE36_LAYOUT = {
  titleRow: 1,
  indicatorFirstRow: 4,
  legendRow: 12,
  monthHeaderRow: 13,
  weekHeaderRow: 14,
  /** Fila `P`/`E` bajo el encabezado de semana (15 en el brief). */
  peRow: 15,
  firstDataRow: 16,
  fixedColumns: 5,
  weeksPerMonth: 4,
  monthsCount: 12,
} as const

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

const FIXED_COLUMN_LABELS = ["OBJETIVO", "N°", "PROGRAMA", "ACTIVIDAD", "RESPONSABLES"]

const CONDITIONAL_RED = "FFFF0000"
const CONDITIONAL_GREEN = "FF00B050"
const P_SCALE_LOW = "FFFFC000"
const P_SCALE_HIGH = "FFB35900"
const ORANGE_BAND = "FFC000"
const HATCH_GRAY = "FF808080"

/**
 * Anchos (en columnas, contadas desde la etiqueta) de los merges de texto
 * libre que no forman parte del cronograma — puramente estéticos, sin
 * relación con `RE36_LAYOUT`. Nombrados para que no queden como números
 * sueltos en medio del código (ronda de arreglos 1/5).
 */
const INDICATOR_VALUE_SPAN = 8
const PLATFORM_LABEL_SPAN = 8
const PLATFORM_NOTE_SPAN = 12
const LEGEND_TEXT_SPAN = 10

/** Convierte un índice de columna 1-based (1 = A) a su letra de Excel. */
function columnLetter(col: number): string {
  let n = col
  let letters = ""
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/**
 * Columna 1-based de la celda P o E para un mes (1-12) y semana (1-4) dados.
 * F = mes1/sem1/P, G = mes1/sem1/E, H = mes1/sem2/P, ... (96 columnas: 12
 * meses × 4 semanas × 2).
 */
function cellColumn(monthIndex: number, weekIndex: number, kind: "P" | "E"): number {
  return (
    RE36_LAYOUT.fixedColumns +
    (monthIndex - 1) * RE36_LAYOUT.weeksPerMonth * 2 +
    (weekIndex - 1) * 2 +
    (kind === "P" ? 1 : 2)
  )
}

/** Dirección de celda (`"F16"`) para un mes/semana/tipo y fila dados. */
export function re36CellAddress(monthIndex: number, weekIndex: number, kind: "P" | "E", row: number): string {
  return `${columnLetter(cellColumn(monthIndex, weekIndex, kind))}${row}`
}

const LAST_COLUMN = RE36_LAYOUT.fixedColumns + RE36_LAYOUT.monthsCount * RE36_LAYOUT.weeksPerMonth * 2

function isGeneralSheetCode(code: string): boolean {
  const normalized = code.toLowerCase()
  return normalized === "pdtp_general" || normalized === "general"
}

function setText(ws: ExcelJS.Worksheet, addr: string, value: unknown, opts?: { bold?: boolean; italic?: boolean }) {
  const cell = ws.getCell(addr)
  cell.value = sanitizeCell(value)
  if (opts?.bold) cell.font = { ...(cell.font ?? {}), bold: true }
  if (opts?.italic) cell.font = { ...(cell.font ?? {}), italic: true }
  return cell
}

function formatPercent(value: number | null): number | string {
  return value === null ? "" : value
}

/** Formulas de la fila "% trimestral": ver `renderSheet` para el detalle de cada modo. */
type QuarterFormulaMode = "ratio" | "average"

/**
 * Renderiza el libro completo: una hoja por `doc.sheets` (nombre vía
 * `safeWorksheetName`) más la hoja "Desvíos" (siempre presente, aunque
 * `doc.deviations` esté vacío — Fase 3 la llena).
 */
export function renderPdtpRe36Workbook(
  doc: PdtpRe36Document,
  options?: { quarterFormula?: QuarterFormulaMode },
): ExcelJS.Workbook {
  const quarterFormula: QuarterFormulaMode = options?.quarterFormula ?? "ratio"
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const usedNames = new Set<string>()

  // La hoja "general" es la que lleva `platformIndicators` (indicador de
  // PROGRAMA, no de hoja — ver JSDoc de `PdtpRe36Document.platformIndicators`).
  // Se identifica por código (mismo criterio que `buildPdtpRe36Document`). Si
  // ninguna hoja calza (programa sin hoja general materializada, o filtrado
  // por `sheetCodes` que la excluyó), NINGUNA hoja lleva el bloque — no se
  // usa la primera hoja como respaldo (ronda de arreglos 1/5: eso lo dejaba
  // pegado a los totales de una hoja de cargo cualquiera, que no le
  // corresponden en absoluto).
  const generalSheet = doc.sheets.find((sheet) => isGeneralSheetCode(sheet.code)) ?? null

  for (const sheet of doc.sheets) {
    const worksheetName = safeWorksheetName(sheet.label || sheet.code, usedNames)
    const ws = workbook.addWorksheet(worksheetName)
    renderSheet(ws, doc, sheet, { isGeneral: sheet === generalSheet, quarterFormula })
  }

  renderDeviationsSheet(workbook, doc, usedNames)

  return workbook
}

/** Igual que `renderPdtpRe36Workbook`, pero devuelve el buffer final del libro. */
export async function renderPdtpRe36Buffer(
  doc: PdtpRe36Document,
  options?: { quarterFormula?: QuarterFormulaMode; session?: Session },
): Promise<ArrayBuffer> {
  const workbook = renderPdtpRe36Workbook(doc, { quarterFormula: options?.quarterFormula })

  if (options?.session) {
    const rowCount = doc.sheets.reduce((total, sheet) => total + sheet.rows.length, 0)
    addExportMetadataSheet(workbook, options.session, {
      filters: { programId: doc.program.id, worksiteId: doc.worksite.id, year: doc.program.year },
      rowCount,
      from: null,
      to: null,
    })
  }

  // No usar `xlsxToBase64`: sanea todas las celdas del libro, incluidas las
  // fórmulas (`{formula: "SUM(...)"}`  se serializa a texto con `=` inicial y
  // `sanitizeCell` le antepondría una comilla, convirtiéndola en texto
  // literal). Los textos ya se sanearon celda por celda en `renderSheet`.
  const data = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(data as ArrayBufferLike)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function renderSheet(
  ws: ExcelJS.Worksheet,
  doc: PdtpRe36Document,
  sheet: PdtpRe36Sheet,
  ctx: { isGeneral: boolean; quarterFormula: QuarterFormulaMode },
) {
  // Anchos: A-E fijos (6/5/40/27/29), F.. angostos (3.5) para las 96 columnas
  // de cronograma.
  const widths = [6, 5, 40, 27, 29]
  for (let col = 1; col <= LAST_COLUMN; col++) {
    ws.getColumn(col).width = col <= RE36_LAYOUT.fixedColumns ? widths[col - 1] : 3.5
  }

  // Paneles congelados: 5 columnas fijas, 15 filas de cabecera (hasta la fila
  // P/E inclusive) — constante, no depende del documento.
  ws.views = [{ state: "frozen", xSplit: RE36_LAYOUT.fixedColumns, ySplit: RE36_LAYOUT.peRow }]

  renderHeader(ws, doc)
  renderMonthWeekHeader(ws)

  const rowCount = sheet.rows.length
  const hasRows = rowCount > 0
  const lastDataRow = hasRows ? RE36_LAYOUT.firstDataRow + rowCount - 1 : RE36_LAYOUT.firstDataRow - 1

  renderDataRows(ws, sheet)
  renderBands(ws, sheet)
  renderConditionalFormatting(ws, hasRows, lastDataRow)

  const totalPRow = lastDataRow + 1
  const totalERow = lastDataRow + 2
  const weeklyPercentRow = lastDataRow + 3
  const quarterlyPercentRow = lastDataRow + 4
  renderTotals(ws, { hasRows, lastDataRow, totalPRow, totalERow, weeklyPercentRow, quarterlyPercentRow }, ctx.quarterFormula)

  let cursor = quarterlyPercentRow + 2
  if (ctx.isGeneral) {
    cursor = renderPlatformIndicators(ws, doc, cursor)
  }
  cursor = renderSignatures(ws, doc, cursor)
  cursor = renderChangeControl(ws, doc, cursor)
  cursor = renderGlossary(ws, doc, cursor)
  renderLegend(ws, doc, cursor)
}

function renderHeader(ws: ExcelJS.Worksheet, doc: PdtpRe36Document) {
  const titleRow = RE36_LAYOUT.titleRow
  ws.mergeCells(titleRow, 1, titleRow, RE36_LAYOUT.fixedColumns)
  setText(ws, `A${titleRow}`, `PROGRAMA DE TRABAJO PREVENTIVO SG-SST ${doc.program.year}`, { bold: true })
  ws.getCell(`A${titleRow}`).font = { bold: true, size: 14 }
  ws.mergeCells(titleRow, RE36_LAYOUT.fixedColumns + 1, titleRow, LAST_COLUMN)
  setText(ws, `${columnLetter(RE36_LAYOUT.fixedColumns + 1)}${titleRow}`, `CÓDIGO: ${doc.program.documentCode}`, { bold: true })

  // Identificación del documento: faena, revisión y fecha de corte. Cada
  // faena manda su propia copia de este archivo y lo firma Legal — sin esto
  // impreso, un RE-36 descargado no dice de qué faena es ni a qué fecha
  // corresponde (hallazgo de la ronda de arreglos 1/5). `cutoff.asOf` es
  // siempre ISO (a diferencia de `signatures.*.at`, que puede no serlo), así
  // que se puede recortar de forma determinista sin parsear.
  const identificationRow = titleRow + 1
  const identificationThird = Math.floor(LAST_COLUMN / 3)
  ws.mergeCells(identificationRow, 1, identificationRow, identificationThird)
  setText(ws, `A${identificationRow}`, `Faena: ${doc.worksite.name} (${doc.worksite.code})`, { bold: true })
  ws.mergeCells(identificationRow, identificationThird + 1, identificationRow, identificationThird * 2)
  setText(
    ws,
    `${columnLetter(identificationThird + 1)}${identificationRow}`,
    `Revisión: ${doc.program.documentRevision ?? "—"}`,
    { bold: true },
  )
  ws.mergeCells(identificationRow, identificationThird * 2 + 1, identificationRow, LAST_COLUMN)
  const cutoffDate = doc.cutoff.asOf.slice(0, 10)
  const cutoffMonthLabel = doc.cutoff.month !== null ? `Mes ${doc.cutoff.month}` : "Año completo"
  setText(
    ws,
    `${columnLetter(identificationThird * 2 + 1)}${identificationRow}`,
    `Corte: ${cutoffDate} (${cutoffMonthLabel})`,
    { bold: true },
  )

  const subtitleRow = identificationRow + 1
  ws.mergeCells(subtitleRow, 1, subtitleRow, LAST_COLUMN)
  setText(ws, `A${subtitleRow}`, "Indicadores de desempeño del plan de trabajo anual", { bold: true })

  const fields: Array<[string, unknown]> = [
    ["Objetivo específico", doc.program.indicatorName],
    ["Tipo de indicador", doc.program.indicatorType],
    ["Fórmula de medición", doc.program.indicatorFormula],
    ["Meta", doc.program.complianceTarget],
    ["Periodicidad", doc.program.indicatorPeriodicity],
    ["Responsable de medición", doc.program.measurementOwner],
    ["Resultado", doc.program.annualPercent],
  ]
  fields.forEach(([label, value], index) => {
    const row = RE36_LAYOUT.indicatorFirstRow + index
    ws.mergeCells(row, 1, row, 2)
    setText(ws, `A${row}`, label, { bold: true })
    ws.mergeCells(row, 3, row, RE36_LAYOUT.fixedColumns + INDICATOR_VALUE_SPAN)
    const valueCell = ws.getCell(`C${row}`)
    if (label === "Meta" || label === "Resultado") {
      valueCell.value = typeof value === "number" ? value : ""
      valueCell.numFmt = "0%"
    } else {
      valueCell.value = sanitizeCell(value)
    }
  })

  // Banda naranja "Planeación del plan de trabajo anual" — aparece en todas
  // las hojas, incluso donde no aplica (§2.2 del análisis del Excel original).
  const bandRow = RE36_LAYOUT.legendRow - 1
  ws.mergeCells(bandRow, 1, bandRow, LAST_COLUMN)
  const bandCell = setText(ws, `A${bandRow}`, "Planeación del plan de trabajo anual", { bold: true })
  bandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE_BAND } }
  bandCell.alignment = { horizontal: "center" }

  const legendRow = RE36_LAYOUT.legendRow
  ws.mergeCells(legendRow, 1, legendRow, LAST_COLUMN)
  setText(ws, `A${legendRow}`, "P: Planeado  E: Ejecutado", { bold: true })
}

function renderMonthWeekHeader(ws: ExcelJS.Worksheet) {
  const { monthHeaderRow, weekHeaderRow, peRow, fixedColumns } = RE36_LAYOUT

  FIXED_COLUMN_LABELS.forEach((label, index) => {
    const col = index + 1
    ws.mergeCells(monthHeaderRow, col, peRow, col)
    const cell = setText(ws, `${columnLetter(col)}${monthHeaderRow}`, label, { bold: true })
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
  })

  for (let month = 1; month <= RE36_LAYOUT.monthsCount; month++) {
    const monthStartCol = fixedColumns + (month - 1) * RE36_LAYOUT.weeksPerMonth * 2 + 1
    const monthEndCol = monthStartCol + RE36_LAYOUT.weeksPerMonth * 2 - 1
    ws.mergeCells(monthHeaderRow, monthStartCol, monthHeaderRow, monthEndCol)
    const monthCell = setText(ws, `${columnLetter(monthStartCol)}${monthHeaderRow}`, MONTH_NAMES[month - 1], { bold: true })
    monthCell.alignment = { horizontal: "center" }

    for (let week = 1; week <= RE36_LAYOUT.weeksPerMonth; week++) {
      const weekStartCol = monthStartCol + (week - 1) * 2
      ws.mergeCells(weekHeaderRow, weekStartCol, weekHeaderRow, weekStartCol + 1)
      const weekCell = setText(ws, `${columnLetter(weekStartCol)}${weekHeaderRow}`, `Sem ${week}`, { bold: true })
      weekCell.alignment = { horizontal: "center" }

      setText(ws, `${columnLetter(weekStartCol)}${peRow}`, "P", { bold: true }).alignment = { horizontal: "center" }
      setText(ws, `${columnLetter(weekStartCol + 1)}${peRow}`, "E", { bold: true }).alignment = { horizontal: "center" }
    }
  }
}

function renderDataRows(ws: ExcelJS.Worksheet, sheet: PdtpRe36Sheet) {
  sheet.rows.forEach((row, index) => {
    const excelRow = RE36_LAYOUT.firstDataRow + index
    setText(ws, `B${excelRow}`, row.n)
    setText(ws, `C${excelRow}`, row.program)
    setText(ws, `D${excelRow}`, row.activity)
    setText(ws, `E${excelRow}`, row.responsibles)

    for (let month = 1; month <= RE36_LAYOUT.monthsCount; month++) {
      for (let week = 1; week <= RE36_LAYOUT.weeksPerMonth; week++) {
        const cell = row.cells[(month - 1) * RE36_LAYOUT.weeksPerMonth + (week - 1)] ?? { p: null, e: null }
        const pAddr = re36CellAddress(month, week, "P", excelRow)
        const eAddr = re36CellAddress(month, week, "E", excelRow)
        if (cell.p !== null) ws.getCell(pAddr).value = cell.p
        if (cell.e !== null) ws.getCell(eAddr).value = cell.e
        // `cell.note`: el modelo no lo populúa hoy (reservado para una fase
        // futura, ver JSDoc de `PdtpRe36Cell`), pero si llega a traer algo se
        // adjunta como nota de Excel a la celda que sí tenga un valor escrito
        // (E si hay ejecución, si no P) en vez de descartarlo en silencio.
        if (cell.note) ws.getCell(cell.e !== null ? eAddr : pAddr).note = sanitizeCell(cell.note) as string
      }
    }

    // Actividades a demanda ("on_demand") o gatilladas por evento
    // ("triggered") no tienen celdas planificadas por definición, y sí
    // pertenecen al documento: se marcan con el relleno achurado en las 96
    // celdas del cronograma, sin filtrar la fila (brief §2.3, "barra
    // achurada"). Se aplica también a las "mixtas" (con P además del
    // achurado) — el achurado marca el patrón de frecuencia, no la ausencia
    // de datos.
    if (row.scheduleMode === "on_demand" || row.scheduleMode === "triggered") {
      for (let col = RE36_LAYOUT.fixedColumns + 1; col <= LAST_COLUMN; col++) {
        ws.getCell(`${columnLetter(col)}${excelRow}`).fill = {
          type: "pattern",
          pattern: "lightUp",
          fgColor: { argb: HATCH_GRAY },
          bgColor: { argb: "FFFFFFFF" },
        }
      }
    }
  })
}

function renderBands(ws: ExcelJS.Worksheet, sheet: PdtpRe36Sheet) {
  for (const band of sheet.bands) {
    const fromRow = RE36_LAYOUT.firstDataRow + band.fromRow - 1
    const toRow = RE36_LAYOUT.firstDataRow + band.toRow - 1
    if (toRow > fromRow) ws.mergeCells(fromRow, 1, toRow, 1)
    const label = band.code ? `${band.code}. ${band.name}` : band.name
    const cell = setText(ws, `A${fromRow}`, label, { bold: true })
    cell.alignment = { textRotation: 90, horizontal: "center", vertical: "middle", wrapText: true }
  }
}

/**
 * Formato condicional del semáforo (columnas E) y de la escala de color
 * (columnas P). Un solo bloque por tipo de columna en vez de 96 llamadas
 * (una por semana): `ref` de ExcelJS acepta una lista de rangos separados
 * por espacio (equivalente al `sqref` de OOXML, que admite múltiples
 * referencias), así que las 48 columnas E entran en un solo `addConditionalFormatting`
 * con prioridades 1-3 (únicas en toda la hoja, no repetidas 48 veces), y lo
 * mismo para las 48 columnas P.
 *
 * **Regla de vacíos (CRITICAL, ronda de arreglos 1/5):** una celda E sin
 * ejecución reportada no se escribe (`cell.e === null` → no se asigna
 * `.value`, ver `renderDataRows`), así que queda genuinamente vacía. En
 * Excel/LibreOffice, una regla `cellIs equal 0` SÍ hace match sobre una
 * celda vacía (el vacío se evalúa como 0 en la comparación numérica) — sin
 * una regla que lo excluya explícitamente, la regla roja pintaría de rojo
 * casi toda la grilla de un RE-36 real (89 actividades, la mayoría con solo
 * unas pocas de las 48 semanas planificadas), tapando además el achurado de
 * las actividades a demanda. El Excel original resuelve esto con una tercera
 * regla `containsBlanks`/fórmula `LEN(TRIM(celda))=0` **por delante** (mayor
 * precedencia, número de prioridad menor) de la regla del 0: cuando varias
 * reglas de un mismo atributo (relleno) hacen match sobre la misma celda,
 * Excel aplica el relleno de la regla de mayor precedencia (menor prioridad)
 * que lo define explícitamente — por eso esta regla fija `pattern: "none"`
 * en vez de dejar `style` vacío, para competir de verdad por el atributo
 * `fill` y ganarle a la regla roja en las celdas vacías. Una celda con el
 * valor literal `0` no calza con `LEN(TRIM(...))=0` (`TRIM(0)` es el texto
 * `"0"`, de largo 1), así que sigue pintándose de rojo correctamente.
 *
 * **Umbral verde:** `executedQuantity`/`plannedQuantity` son `numeric(10,2)`
 * en la base (`db/schema/prevention/pdtp.ts`) y el Zod de captura no exige
 * enteros (`z.coerce.number().min(0)`, sin `.int()`), así que un valor como
 * `0.5` es alcanzable. `cellIs between [1, 1e9]` reproduce exactamente
 * "E ≥ 1" del Excel original (ExcelJS no tipa un operador
 * `greaterThanOrEqual`); `greaterThan 0` habría pintado `0.5` de verde, que
 * el original no hace.
 *
 * Nota honesta: esto reproduce la estructura de reglas del Excel original
 * (verificada contra el archivo fuente), pero no hay forma de comprobar en
 * este entorno que Excel/LibreOffice efectivamente evalúan la precedencia
 * como se describe arriba — no hay motor de cálculo disponible aquí (mismo
 * hueco de LibreOffice documentado en el informe de la tarea). El test
 * asociado verifica la estructura de las reglas (tipos, fórmulas,
 * prioridades relativas), no el resultado visual.
 */
function renderConditionalFormatting(ws: ExcelJS.Worksheet, hasRows: boolean, lastDataRow: number) {
  if (!hasRows) return
  const { firstDataRow } = RE36_LAYOUT

  const eRanges: string[] = []
  const pRanges: string[] = []
  for (let month = 1; month <= RE36_LAYOUT.monthsCount; month++) {
    for (let week = 1; week <= RE36_LAYOUT.weeksPerMonth; week++) {
      const eCol = columnLetter(cellColumn(month, week, "E"))
      eRanges.push(`${eCol}${firstDataRow}:${eCol}${lastDataRow}`)
      const pCol = columnLetter(cellColumn(month, week, "P"))
      pRanges.push(`${pCol}${firstDataRow}:${pCol}${lastDataRow}`)
    }
  }

  // Ancla de la fórmula de vacíos: la esquina superior izquierda del primer
  // rango del `sqref` (mes 1 / semana 1 / E). Excel ajusta la referencia
  // relativa para cada celda del `sqref`, incluidas las de rangos no
  // contiguos, igual que si fuera un solo rango — mismo mecanismo que usa el
  // Excel original (ancla en la fila 14, ver el brief).
  const eAnchor = re36CellAddress(1, 1, "E", firstDataRow)

  ws.addConditionalFormatting({
    ref: eRanges.join(" "),
    rules: [
      {
        type: "expression",
        formulae: [`LEN(TRIM(${eAnchor}))=0`],
        priority: 1,
        style: { fill: { type: "pattern", pattern: "none" } },
      },
      {
        type: "cellIs",
        operator: "equal",
        formulae: ["0"],
        priority: 2,
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: CONDITIONAL_RED } } },
      },
      {
        type: "cellIs",
        operator: "between",
        formulae: ["1", "1000000000"],
        priority: 3,
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: CONDITIONAL_GREEN } } },
      },
    ],
  })

  ws.addConditionalFormatting({
    ref: pRanges.join(" "),
    rules: [
      {
        type: "colorScale",
        priority: 4,
        cfvo: [{ type: "num", value: 1 }, { type: "num", value: 5 }],
        color: [{ argb: P_SCALE_LOW }, { argb: P_SCALE_HIGH }],
      },
    ],
  })
}

function renderTotals(
  ws: ExcelJS.Worksheet,
  rows: { hasRows: boolean; lastDataRow: number; totalPRow: number; totalERow: number; weeklyPercentRow: number; quarterlyPercentRow: number },
  quarterFormula: QuarterFormulaMode,
) {
  const { hasRows, lastDataRow, totalPRow, totalERow, weeklyPercentRow, quarterlyPercentRow } = rows
  const { firstDataRow, fixedColumns } = RE36_LAYOUT

  ws.mergeCells(totalPRow, 1, totalPRow, fixedColumns)
  setText(ws, `A${totalPRow}`, "Actividades Programadas (P)", { bold: true })
  ws.mergeCells(totalERow, 1, totalERow, fixedColumns)
  setText(ws, `A${totalERow}`, "Actividades Ejecutadas (E)", { bold: true })
  ws.mergeCells(weeklyPercentRow, 1, weeklyPercentRow, fixedColumns)
  setText(ws, `A${weeklyPercentRow}`, "% Cumplimiento semanal", { bold: true })
  ws.mergeCells(quarterlyPercentRow, 1, quarterlyPercentRow, fixedColumns)
  setText(ws, `A${quarterlyPercentRow}`, "% Cumplimiento trimestral", { bold: true })

  for (let month = 1; month <= RE36_LAYOUT.monthsCount; month++) {
    for (let week = 1; week <= RE36_LAYOUT.weeksPerMonth; week++) {
      const pCol = columnLetter(cellColumn(month, week, "P"))
      const eCol = columnLetter(cellColumn(month, week, "E"))

      const pTotalCell = ws.getCell(`${pCol}${totalPRow}`)
      const eTotalCell = ws.getCell(`${eCol}${totalERow}`)
      if (hasRows) {
        pTotalCell.value = { formula: `SUM(${pCol}${firstDataRow}:${pCol}${lastDataRow})` }
        eTotalCell.value = { formula: `SUM(${eCol}${firstDataRow}:${eCol}${lastDataRow})` }
      } else {
        // Sin filas de datos no hay nada que sumar; una fórmula referenciaría
        // un rango vacío o, peor, la propia fila de totales. Se deja el valor
        // literal 0 — sigue derivado de `rows.length`, solo que el resultado
        // ya se conoce sin necesidad de fórmula.
        pTotalCell.value = 0
        eTotalCell.value = 0
      }

      const percentCell = ws.getCell(`${eCol}${weeklyPercentRow}`)
      percentCell.value = hasRows
        ? { formula: `IFERROR(${eCol}${totalERow}/${pCol}${totalPRow},"")` }
        : ""
      percentCell.numFmt = "0%"
    }
  }

  // Trimestral: 4 trimestres de 3 meses (12 semanas c/u). Los totales
  // semanales de P/E son columnas no contiguas (P y E se intercalan), así que
  // la suma se arma como adición explícita de las 12 celdas de esa fila, no
  // como un único `SUM(rango)` — un rango contiguo incluiría columnas del
  // tipo contrario.
  for (let quarter = 0; quarter < 4; quarter++) {
    const monthsInQuarter: [number, number, number] = [quarter * 3 + 1, quarter * 3 + 2, quarter * 3 + 3]
    const weeksInQuarter = monthsInQuarter.flatMap((month) =>
      Array.from({ length: RE36_LAYOUT.weeksPerMonth }, (_, i) => ({ month, week: i + 1 })),
    )
    const quarterStartCol = cellColumn(monthsInQuarter[0], 1, "P")
    const quarterEndCol = cellColumn(monthsInQuarter[2], RE36_LAYOUT.weeksPerMonth, "E")
    ws.mergeCells(quarterlyPercentRow, quarterStartCol, quarterlyPercentRow, quarterEndCol)
    const cell = ws.getCell(`${columnLetter(quarterStartCol)}${quarterlyPercentRow}`)
    cell.numFmt = "0%"

    if (!hasRows) {
      cell.value = ""
      continue
    }

    if (quarterFormula === "ratio") {
      const pSum = weeksInQuarter.map(({ month, week }) => `${columnLetter(cellColumn(month, week, "P"))}${totalPRow}`).join("+")
      const eSum = weeksInQuarter.map(({ month, week }) => `${columnLetter(cellColumn(month, week, "E"))}${totalERow}`).join("+")
      cell.value = { formula: `IFERROR((${eSum})/(${pSum}),"")` }
      cell.note = "Razón ΣE/ΣP del trimestre (suma de ejecutado sobre suma de planeado), no un promedio de los porcentajes semanales."
    } else {
      const percentCells = weeksInQuarter.map(({ month, week }) => `${columnLetter(cellColumn(month, week, "E"))}${weeklyPercentRow}`)
      cell.value = { formula: `IFERROR(AVERAGE(${percentCells.join(",")}),"")` }
      cell.note = "Promedio simple de los % semanales del trimestre (reproduce el Excel original): las semanas con P = 0 devuelven \"\" y AVERAGE las excluye — no equivale a ΣE/ΣP."
    }
  }
}

function renderPlatformIndicators(ws: ExcelJS.Worksheet, doc: PdtpRe36Document, startRow: number): number {
  let row = startRow
  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns + PLATFORM_LABEL_SPAN)
  setText(ws, `A${row}`, "Indicador de la plataforma — programa completo", { bold: true })
  row += 1

  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns + PLATFORM_NOTE_SPAN)
  const noteCell = setText(
    ws,
    `A${row}`,
    "Indicador del PROGRAMA completo en esta faena (no un total de esta hoja): cuenta solo ejecuciones aprobadas, aplica un tope mensual y trata la cobertura como todo-o-nada. Puede diferir del total \"Actividades Ejecutadas (E)\" de esta hoja, que suma lo planificado/ejecutado crudo de las filas visibles aquí.",
    { italic: true },
  )
  noteCell.alignment = { wrapText: true }
  row += 2

  const monthlyHeaderRow = row
  const monthlyHeaders = ["Mes", "Planificado", "Ejecutado", "% Cumplimiento", "Actividades en cero"]
  monthlyHeaders.forEach((label, index) => setText(ws, `${columnLetter(index + 1)}${monthlyHeaderRow}`, label, { bold: true }))
  row += 1

  for (const month of doc.platformIndicators.monthly) {
    setText(ws, `A${row}`, MONTH_NAMES[month.month - 1] ?? month.month)
    ws.getCell(`B${row}`).value = month.planned
    ws.getCell(`C${row}`).value = month.executed
    const percentCell = ws.getCell(`D${row}`)
    percentCell.value = formatPercent(month.percent)
    percentCell.numFmt = "0%"
    ws.getCell(`E${row}`).value = month.zeroActivities
    row += 1
  }

  row += 1
  const quarterlyHeaderRow = row
  const quarterlyHeaders = ["Trimestre", "Planificado", "Ejecutado", "% Cumplimiento"]
  quarterlyHeaders.forEach((label, index) => setText(ws, `${columnLetter(index + 1)}${quarterlyHeaderRow}`, label, { bold: true }))
  row += 1

  for (const quarter of doc.platformIndicators.quarterly) {
    setText(ws, `A${row}`, `Q${quarter.quarter}`)
    ws.getCell(`B${row}`).value = quarter.planned
    ws.getCell(`C${row}`).value = quarter.executed
    const percentCell = ws.getCell(`D${row}`)
    percentCell.value = formatPercent(quarter.percent)
    percentCell.numFmt = "0%"
    row += 1
  }

  return row + 1
}

function renderSignatureRow(
  ws: ExcelJS.Worksheet,
  row: number,
  role: string,
  entry: { name: string; title: string; at: string | null } | null,
) {
  setText(ws, `A${row}`, role, { bold: true })
  setText(ws, `B${row}`, entry?.name ?? "—")
  setText(ws, `C${row}`, entry?.title ?? "—")
  setText(ws, `D${row}`, entry?.at ?? "—")
}

function renderSignatures(ws: ExcelJS.Worksheet, doc: PdtpRe36Document, startRow: number): number {
  let row = startRow
  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns)
  setText(ws, `A${row}`, "Firmas", { bold: true })
  row += 1

  const headerRow = row
  ;["Rol", "Nombre", "Cargo", "Fecha"].forEach((label, index) => setText(ws, `${columnLetter(index + 1)}${headerRow}`, label, { bold: true }))
  row += 1

  renderSignatureRow(ws, row, "Elaborado por", doc.signatures.elaboratedBy)
  row += 1
  renderSignatureRow(ws, row, "Revisado por (JDPR)", doc.signatures.reviewedByJdpr)
  row += 1
  renderSignatureRow(ws, row, "Aprobado por (Legal)", doc.signatures.approvedByLegal)
  row += 1

  return row + 1
}

function renderChangeControl(ws: ExcelJS.Worksheet, doc: PdtpRe36Document, startRow: number): number {
  let row = startRow
  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns)
  setText(ws, `A${row}`, "Control de cambios", { bold: true })
  row += 1

  const headerRow = row
  ;["Fecha", "Descripción", "Responsable"].forEach((label, index) => setText(ws, `${columnLetter(index + 1)}${headerRow}`, label, { bold: true }))
  row += 1

  for (const entry of doc.changeControl) {
    setText(ws, `A${row}`, entry.at)
    setText(ws, `B${row}`, entry.description)
    setText(ws, `C${row}`, entry.actor ?? "—")
    row += 1
  }

  return row + 1
}

function renderGlossary(ws: ExcelJS.Worksheet, doc: PdtpRe36Document, startRow: number): number {
  let row = startRow
  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns)
  setText(ws, `A${row}`, "Glosario de siglas", { bold: true })
  row += 1

  const headerRow = row
  ;["Código", "Descripción"].forEach((label, index) => setText(ws, `${columnLetter(index + 1)}${headerRow}`, label, { bold: true }))
  row += 1

  for (const entry of doc.glossary) {
    setText(ws, `A${row}`, entry.code)
    setText(ws, `B${row}`, entry.label)
    row += 1
  }

  return row + 1
}

function renderLegend(ws: ExcelJS.Worksheet, doc: PdtpRe36Document, startRow: number) {
  let row = startRow
  ws.mergeCells(row, 1, row, RE36_LAYOUT.fixedColumns)
  setText(ws, `A${row}`, "Leyenda", { bold: true })
  row += 1

  const legendEntries: Array<[string, string]> = [
    ["Actividad a demanda (achurado)", doc.legend.onDemand],
    ["E = 0", doc.legend.e0],
    ["E ≥ 1", doc.legend.eGte1],
  ]
  for (const [label, text] of legendEntries) {
    setText(ws, `A${row}`, label, { bold: true })
    ws.mergeCells(row, 2, row, RE36_LAYOUT.fixedColumns + LEGEND_TEXT_SPAN)
    const cell = setText(ws, `B${row}`, text)
    cell.alignment = { wrapText: true }
    row += 1
  }
}

function renderDeviationsSheet(workbook: ExcelJS.Workbook, doc: PdtpRe36Document, usedNames: Set<string>) {
  const ws = workbook.addWorksheet(safeWorksheetName("Desvíos", usedNames))
  const headers = ["N°", "Actividad", "Mes", "Sem", "Tipo", "Motivo", "Destino", "Registrado por", "Fecha"]
  headers.forEach((label, index) => setText(ws, `${columnLetter(index + 1)}1`, label, { bold: true }))
  ws.views = [{ state: "frozen", ySplit: 1 }]

  doc.deviations.forEach((deviation, index) => {
    const row = index + 2
    setText(ws, `A${row}`, deviation.n)
    setText(ws, `B${row}`, deviation.activity)
    setText(ws, `C${row}`, deviation.month)
    setText(ws, `D${row}`, deviation.week)
    setText(ws, `E${row}`, deviation.kind)
    setText(ws, `F${row}`, deviation.reason)
    const destino = deviation.targetMonth !== null && deviation.targetWeek !== null
      ? `Mes ${deviation.targetMonth} Sem ${deviation.targetWeek}`
      : "—"
    setText(ws, `G${row}`, destino)
    setText(ws, `H${row}`, deviation.recordedBy)
    setText(ws, `I${row}`, deviation.recordedAt)
  })

  for (let col = 1; col <= headers.length; col++) ws.getColumn(col).width = 18
}
