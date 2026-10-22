/** Constantes de los importadores del control seguras para el cliente (sin exceljs ni node:crypto). */
export type ControlImportKind = "telemetry" | "supply_inputs"

export const CONTROL_IMPORT_KIND_LABELS: Record<ControlImportKind, string> = {
  telemetry: "Telemetría diaria",
  supply_inputs: "Entradas de surtidor o tarjeta",
}

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000
