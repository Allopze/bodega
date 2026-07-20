export const EPP_REQUIREMENT_SCOPE_LABELS: Record<string, string> = {
  global: "Toda la organización",
  worksite: "Faena",
  position: "Cargo",
  task: "Tarea",
}

export const EPP_GAP_TYPE_LABELS: Record<"missing" | "expired", string> = {
  missing: "Nunca entregado",
  expired: "Vencido",
}

export interface EppWorkerRow {
  id: string
  firstName: string
  lastName: string
  position: string | null
  worksiteId: string
  isActive: boolean
}

export interface EppRequirementRow {
  id: string
  eppTypeId: string
  eppTypeLabel: string
  scopeType: string
  scopeValue: string | null
  worksiteId: string | null
  enforcement: string
  reason: string
  isActive: boolean
}

/** Una entrega real del EPP exigido, con la vida útil de la familia entregada (si la declara). */
export interface EppDeliveryRow {
  workerId: string
  eppTypeId: string
  deliveredAt: string
  lifespanMonths: number | null
}

export interface EppCoverageGap {
  workerId: string
  workerName: string
  worksiteId: string
  position: string | null
  eppTypeId: string
  eppTypeLabel: string
  requirementId: string
  enforcement: "blocking" | "warning"
  reason: string
  gapType: "missing" | "expired"
  lastDeliveredAt: string | null
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("es-CL")
}

/**
 * Mismo criterio de alcance que `requirementApplies` de Capacitación: un
 * requisito por tarea no se resuelve contra la dotación estática, sino al
 * asignar la tarea — mismo diferimiento ya aceptado ahí, no una omisión
 * nueva de esta capacidad.
 */
export function requirementApplies(requirement: EppRequirementRow, worker: EppWorkerRow) {
  if (!requirement.isActive) return false
  switch (requirement.scopeType) {
    case "global":
      return true
    case "worksite":
      return requirement.worksiteId === worker.worksiteId
    case "position":
      return normalize(requirement.scopeValue) !== "" && normalize(requirement.scopeValue) === normalize(worker.position)
    default:
      return false
  }
}

function addMonths(dateIso: string, months: number) {
  const date = new Date(dateIso)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

/**
 * Cruza dotación activa × requisitos vigentes × entregas reales y devuelve
 * las brechas de cobertura. Se compara contra la entrega más reciente del
 * tipo de EPP exigido: una entrega sin vida útil declarada en la familia se
 * trata como vigente indefinidamente (no genera brecha por vencimiento) — a
 * diferencia del criterio "no comparable ≠ cumple" de higiene, porque la
 * ausencia de vida útil es el estado normal de mucho EPP (cascos, arneses
 * sin fecha fija) y forzar brecha perpetua sería ruido, no protección.
 */
export function computeEppCoverageGaps(args: {
  workers: EppWorkerRow[]
  requirements: EppRequirementRow[]
  deliveries: EppDeliveryRow[]
  asOf: string
}): EppCoverageGap[] {
  const latestByWorkerType = new Map<string, EppDeliveryRow>()
  for (const delivery of args.deliveries) {
    const key = `${delivery.workerId}:${delivery.eppTypeId}`
    const current = latestByWorkerType.get(key)
    if (!current || delivery.deliveredAt > current.deliveredAt) latestByWorkerType.set(key, delivery)
  }

  const gaps: EppCoverageGap[] = []
  for (const worker of args.workers) {
    if (!worker.isActive) continue
    for (const requirement of args.requirements) {
      if (!requirementApplies(requirement, worker)) continue
      const delivery = latestByWorkerType.get(`${worker.id}:${requirement.eppTypeId}`)

      let gapType: "missing" | "expired" | null = null
      if (!delivery) {
        gapType = "missing"
      } else if (delivery.lifespanMonths !== null && addMonths(delivery.deliveredAt, delivery.lifespanMonths) < args.asOf) {
        gapType = "expired"
      }
      if (!gapType) continue

      gaps.push({
        workerId: worker.id,
        workerName: `${worker.firstName} ${worker.lastName}`.trim(),
        worksiteId: worker.worksiteId,
        position: worker.position,
        eppTypeId: requirement.eppTypeId,
        eppTypeLabel: requirement.eppTypeLabel,
        requirementId: requirement.id,
        enforcement: requirement.enforcement === "blocking" ? "blocking" : "warning",
        reason: requirement.reason,
        gapType,
        lastDeliveredAt: delivery?.deliveredAt ?? null,
      })
    }
  }
  return gaps
}
