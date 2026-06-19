type ActaFilenameInput = {
  tipo: string
  workerName: string
}

const TIPO_EVALUACION_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  seguimiento: "Seguimiento",
}

export function buildActaFilename({ tipo, workerName }: ActaFilenameInput): string {
  const tipoLabel = TIPO_EVALUACION_LABELS[tipo] ?? tipo
  const cleanWorkerName = workerName.trim().replace(/\s+/g, " ")

  return sanitizePdfFilename(`Evaluación ${tipoLabel} ${cleanWorkerName}.pdf`)
}

function sanitizePdfFilename(filename: string): string {
  return filename
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    .replace(/[/:*?"<>|\\]/g, "_")
}
