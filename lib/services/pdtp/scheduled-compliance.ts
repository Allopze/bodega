/**
 * Cumplimiento de las ocurrencias materializadas del creador nuevo.
 *
 * La función es deliberadamente independiente de Drizzle: el denominador es
 * la suma de cantidades planificadas de cada instancia exigible, no una marca
 * anual de la actividad. Esto permite usarla tanto en los indicadores como en
 * exportaciones y pruebas sin repetir las reglas de estados.
 */

export type PdtpScheduledComplianceRow = {
  status: string
  scheduledFor: string
  completedAt?: string | null
  plannedQuantity: number | string
}

export type PdtpScheduledCompliance = {
  planned: number
  completed: number
  completedOnTime: number
  completedLate: number
  pending: number
  notApplicable: number
  cancelled: number
  plannedVsCompleted: number | null
  closedOnTime: number | null
}

function quantity(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function completionBucket(row: PdtpScheduledComplianceRow): "on_time" | "late" | "unknown" {
  if (row.status !== "completed") return "unknown"
  const completedDate = row.completedAt?.slice(0, 10)
  if (!completedDate) return "unknown"
  return completedDate <= row.scheduledFor ? "on_time" : "late"
}

export function calculatePdtpScheduledInstanceCompliance(
  rows: readonly PdtpScheduledComplianceRow[],
): PdtpScheduledCompliance {
  let planned = 0
  let completed = 0
  let completedOnTime = 0
  let completedLate = 0
  let pending = 0
  let notApplicable = 0
  let cancelled = 0

  for (const row of rows) {
    const amount = quantity(row.plannedQuantity)
    if (row.status === "not_applicable") {
      notApplicable += amount
      continue
    }
    if (row.status === "cancelled") {
      cancelled += amount
      continue
    }

    planned += amount
    if (row.status === "completed") {
      completed += amount
      const bucket = completionBucket(row)
      if (bucket === "on_time") completedOnTime += amount
      if (bucket === "late" || bucket === "unknown") completedLate += amount
    } else {
      // `submitted` no cuenta como cumplimiento, pero sigue siendo trabajo
      // exigible y por eso permanece en el denominador.
      pending += amount
    }
  }

  const cappedCompleted = Math.min(completed, planned)
  return {
    planned,
    completed: cappedCompleted,
    completedOnTime: Math.min(completedOnTime, planned),
    completedLate: Math.min(completedLate, planned),
    pending,
    notApplicable,
    cancelled,
    plannedVsCompleted: planned > 0 ? cappedCompleted / planned : null,
    closedOnTime: planned > 0 ? Math.min(completedOnTime, planned) / planned : null,
  }
}
