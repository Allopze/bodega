/**
 * Plantillas descargables de los importadores del control (I-05). Los
 * encabezados de la hoja de datos son EXACTAMENTE los primeros alias de las
 * columnas que lee cada parser (un test lo comprueba); la hoja «Instrucciones»
 * explica cada columna y las reglas de rechazo.
 */
import ExcelJS from "exceljs"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { SUPPLY_INPUT_COLUMNS } from "./supply-inputs"
import { TELEMETRY_COLUMNS } from "./telemetry"
import type { ControlImportKind } from "./shared"

interface TemplateColumn { header: string; required: boolean; width: number; help: string }

export const TELEMETRY_TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: "Equipo", required: true, width: 16, help: "Código interno del equipo (ej. KA-63) o su patente, con o sin guion. Debe existir en el catálogo de equipos y en una faena de tu alcance." },
  { header: "Fecha", required: true, width: 14, help: "Día de la telemetría en formato dd-mm-aaaa (ej. 15-01-2026) o una celda de fecha de Excel. Se rechazan las fechas de relleno (30-12-1899) y las futuras." },
  { header: "Horas funcionamiento", required: true, width: 22, help: "Horas con el motor encendido ese día, con coma decimal (ej. 7,5). Entre 0 y 24." },
  { header: "Horas en vacío", required: true, width: 16, help: "Horas con el motor encendido sin trabajar (ralentí), con coma decimal. No pueden superar las horas de funcionamiento. El % de ralentí lo calcula la plataforma." },
  { header: "Litros trabajando", required: false, width: 18, help: "Litros consumidos trabajando. Opcional." },
  { header: "Litros en vacío", required: false, width: 16, help: "Litros consumidos en vacío. Opcional (obligatoria si usas «Litros totales»)." },
  { header: "Litros totales", required: false, width: 16, help: "Alternativa a «Litros trabajando»: la plataforma calcula trabajando = totales − en vacío. No informes ambas." },
]

export const SUPPLY_INPUT_TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: "Fecha", required: true, width: 14, help: "Día del despacho en formato dd-mm-aaaa o celda de fecha de Excel." },
  { header: "Hora", required: false, width: 10, help: "Hora del despacho (HH:MM), opcional." },
  { header: "Faena", required: true, width: 24, help: "Nombre o código de la faena, tal como está en la plataforma (no distingue mayúsculas ni tildes). Debe estar en tu alcance." },
  { header: "Litros", required: true, width: 12, help: "Litros despachados, mayores que cero, con coma decimal (ej. 1.250,5)." },
  { header: "Referencia", required: true, width: 18, help: "Guía de despacho o folio del medio. Es la llave que evita duplicar el despacho al reimportar: debe ir una sola vez por medio." },
  { header: "Patente o estanque", required: false, width: 20, help: "Patente del equipo atendido o nombre del estanque. Opcional; si es una patente del catálogo, el despacho queda asociado al equipo." },
]

const CONFIG: Record<ControlImportKind, { sheet: string; columns: TemplateColumn[]; notes: string[]; filename: string }> = {
  telemetry: {
    sheet: "Telemetria",
    columns: TELEMETRY_TEMPLATE_COLUMNS,
    filename: "plantilla-telemetria-diaria.xlsx",
    notes: [
      "Una fila por equipo y día. Borra cualquier fila de ejemplo antes de subir el archivo.",
      "Formatos: fechas dd-mm-aaaa; números con coma decimal (7,5) y punto de miles opcional.",
      "Al subir eliges la fuente (por defecto VisionLink). Reimportar días ya cargados de la misma fuente los actualiza, no los duplica.",
      "Qué se rechaza: equipo desconocido o de otra faena, fecha vacía, de relleno o futura, horas fuera de 0–24, vacío mayor que funcionamiento, litros negativos y el mismo equipo y día repetido en el archivo.",
      "Las filas rechazadas quedan guardadas con su motivo y puedes descargarlas en Excel para corregirlas.",
    ],
  },
  supply_inputs: {
    sheet: "Entradas",
    columns: SUPPLY_INPUT_TEMPLATE_COLUMNS,
    filename: "plantilla-entradas-surtidor-tarjeta.xlsx",
    notes: [
      "Una fila por despacho. Borra cualquier fila de ejemplo antes de subir el archivo.",
      "Al subir eliges el medio de suministro (surtidor CMPC, tarjeta u otro): todas las filas del archivo pertenecen a ese medio.",
      "Reimportar una referencia ya cargada para el mismo medio la actualiza, no la duplica.",
      "Qué se rechaza: fecha vacía, inválida o futura, faena desconocida o fuera de tu alcance, litros en cero o vacíos, referencia vacía o repetida en el archivo.",
      "Las filas rechazadas quedan guardadas con su motivo y puedes descargarlas en Excel para corregirlas.",
    ],
  },
}

export function templateFilename(kind: ControlImportKind): string {
  return CONFIG[kind].filename
}

/** Encabezados de la hoja de datos de la plantilla, en orden. */
export function templateHeaders(kind: ControlImportKind): string[] {
  return CONFIG[kind].columns.map((column) => column.header)
}

/** Encabezados canónicos que el parser reconoce (primer alias de cada columna). */
export function parserHeaders(kind: ControlImportKind): string[] {
  return (kind === "telemetry" ? TELEMETRY_COLUMNS : SUPPLY_INPUT_COLUMNS).map((column) => column.headers[0]!)
}

export async function buildControlImportTemplateBase64(kind: ControlImportKind): Promise<string> {
  const { sheet, columns, notes } = CONFIG[kind]
  const workbook = new ExcelJS.Workbook()
  const data = workbook.addWorksheet(sheet)
  data.columns = columns.map((column) => ({ header: column.header, key: column.header, width: column.width }))
  data.getRow(1).font = { bold: true }
  data.views = [{ state: "frozen", ySplit: 1 }]

  const guide = workbook.addWorksheet("Instrucciones")
  guide.columns = [
    { header: "Columna", key: "column", width: 26 },
    { header: "¿Obligatoria?", key: "required", width: 14 },
    { header: "Qué poner", key: "help", width: 110 },
  ]
  guide.getRow(1).font = { bold: true }
  for (const column of columns) guide.addRow({ column: column.header, required: column.required ? "Sí" : "No", help: column.help })
  guide.addRow({})
  for (const note of notes) guide.addRow({ column: "Nota", help: note })
  guide.getColumn("help").alignment = { wrapText: true, vertical: "top" }
  return xlsxToBase64(workbook)
}
