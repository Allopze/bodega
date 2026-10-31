/** Tipos de archivo importado y sus rótulos. Sin acceso a datos: lo usan el servidor y el cliente. */
export const IMPORTED_FILE_KINDS = ["tarjeta", "planilla", "telemetria", "surtidor", "sellos"] as const
export type ImportedFileKind = (typeof IMPORTED_FILE_KINDS)[number]

export type ImportedFileStatus = "importado" | "revertido"

export const IMPORTED_FILE_KIND_LABELS: Record<ImportedFileKind, string> = {
  tarjeta: "Reporte de tarjeta",
  planilla: "Planilla de cargas",
  telemetria: "Telemetría",
  surtidor: "Despachos de surtidor",
  sellos: "Histórico de sellos",
}

export const IMPORTED_FILE_STATUS_LABELS: Record<ImportedFileStatus, string> = {
  importado: "Importado",
  revertido: "Revertido",
}

export function isImportedFileKind(value: string | undefined): value is ImportedFileKind {
  return !!value && (IMPORTED_FILE_KINDS as readonly string[]).includes(value)
}

export function isImportedFileStatus(value: string | undefined): value is ImportedFileStatus {
  return value === "importado" || value === "revertido"
}

/** «Copec TCT Diesel» → «Copec · diésel»: sin la sigla del canal. */
export function cardSourceLabel(source: string | null): string | null {
  if (!source) return null
  if (source === "Copec") return "Copec (reporte manual)"
  const copec = /^Copec TCT (Diesel|BlueMax)$/.exec(source)
  if (copec) return `Copec · ${copec[1] === "Diesel" ? "diésel" : "BlueMax"}`
  const aramco = /^Aramco Fleet (.+)$/.exec(source)
  if (aramco) return `Aramco · ${aramco[1] === "Diesel" ? "diésel" : aramco[1] === "AdBlue" ? "AdBlue" : aramco[1]!.toLowerCase()}`
  return source
}
