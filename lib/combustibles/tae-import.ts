import ExcelJS from "exceljs"
import { normKey, sheetToRecords } from "./xlsx-utils"

export interface TaeLegacyImportError {
  rowIndex: number
  field: string
  message: string
}

export interface ParsedTaeLegacyRow {
  rowIndex: number
  legacySourceId: string
  worksiteName: string
  loadedAt: string
  loadingPointName: string
  supervisorName: string
  driverName: string
  equipmentCode: string
  meterReading: number | null
  meterRaw: string | null
  liters: number
  removedSealNumber: string | null
  installedSealNumber: string | null
  notes: string | null
  evidenceUrls: Record<"odometer" | "liter_meter" | "removed_seal" | "installed_seal", string | null>
  rawRow: Record<string, unknown>
}

export interface TaeLegacyImportResult {
  rows: ParsedTaeLegacyRow[]
  errors: TaeLegacyImportError[]
}

const REQUIRED_HEADERS = ["id", "faena", "fecha y hora", "lugar de carga", "supervisor / líder", "conductor", "equipo", "odómetro", "litros"]

function text(value: unknown): string | null {
  const valueText = String(value ?? "").trim()
  return valueText || null
}

function strictNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const valueText = text(value)
  if (!valueText) return null
  const normalized = valueText.replace(/\s/g, "").replace(",", ".")
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null
}

function formatTimestamp(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString()
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (!isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

/** Parser exclusivo del Excel manual TAE. No comparte ni relaja el contrato TCT. */
export async function parseTaeLegacyExcel(fileBuffer: ArrayBuffer | Buffer): Promise<TaeLegacyImportResult> {
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(fileBuffer as never) } catch {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Archivo Excel inválido o corrupto" }] }
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "No se encontró una hoja con datos" }] }
  const records = sheetToRecords(sheet)
  const actualHeaders = new Set(Object.keys(records[0] ?? {}).map(normKey))
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !actualHeaders.has(header))
  if (missingHeaders.length) return { rows: [], errors: missingHeaders.map((field) => ({ rowIndex: 1, field, message: "Encabezado requerido no encontrado" })) }

  const rows: ParsedTaeLegacyRow[] = []
  const errors: TaeLegacyImportError[] = []
  for (let index = 0; index < records.length; index++) {
    const rawRow = records[index]!
    const rowIndex = index + 2
    const values = new Map(Object.entries(rawRow).map(([key, value]) => [normKey(key), value]))
    const get = (key: string) => values.get(normKey(key))
    const legacySourceId = text(get("id"))
    const worksiteName = text(get("faena"))
    const loadedAt = formatTimestamp(get("fecha y hora"))
    const loadingPointName = text(get("lugar de carga"))
    const supervisorName = text(get("supervisor / líder"))
    const driverName = text(get("conductor"))
    const equipmentCode = text(get("equipo"))
    const liters = strictNumber(get("litros"))

    if (!legacySourceId || !worksiteName || !loadedAt || !loadingPointName || !supervisorName || !driverName || !equipmentCode || liters == null || liters <= 0) {
      const fields = [
        !legacySourceId && "ID",
        !worksiteName && "Faena",
        !loadedAt && "Fecha y hora",
        !loadingPointName && "Lugar de carga",
        !supervisorName && "Supervisor / líder",
        !driverName && "Conductor",
        !equipmentCode && "Equipo",
        (liters == null || liters <= 0) && "Litros",
      ].filter(Boolean).join(", ")
      errors.push({ rowIndex, field: fields, message: "Fila incompleta o con litros inválidos" })
      continue
    }

    const meterRaw = text(get("odómetro"))
    rows.push({
      rowIndex,
      legacySourceId,
      worksiteName,
      loadedAt,
      loadingPointName,
      supervisorName,
      driverName,
      equipmentCode,
      meterReading: strictNumber(meterRaw),
      meterRaw,
      liters,
      removedSealNumber: text(get("n.º sello retirado")),
      installedSealNumber: text(get("n.º sello instalado")),
      notes: text(get("observaciones")),
      evidenceUrls: {
        odometer: text(get("imagen odómetro")),
        liter_meter: text(get("imagen medidor de litros")),
        removed_seal: text(get("imagen sello retirado")),
        installed_seal: text(get("imagen sello instalado")),
      },
      rawRow,
    })
  }
  return { rows, errors }
}
