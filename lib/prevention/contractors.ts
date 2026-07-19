export const CONTRACTOR_RELATIONSHIP_LABELS: Record<string, string> = {
  contractor: "Contratista",
  subcontractor: "Subcontratista",
  service_provider: "Prestador de servicios",
}

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Vigente",
  suspended: "Suspendido",
  finished: "Terminado",
}

export const CONTRACTOR_WORKER_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  accredited: "Acreditado",
  rejected: "Rechazado",
  withdrawn: "Retirado",
}

export const ACCREDITATION_ITEM_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  submitted: "Presentado",
  observed: "Observado",
  approved: "Aprobado",
  expired: "Vencido",
}

export const ACCREDITATION_SCOPE_LABELS: Record<string, string> = {
  company: "Empresa",
  contract: "Contrato",
  worker: "Trabajador",
}

export const COORDINATION_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  held: "Realizada",
  closed: "Cerrada",
  cancelled: "Cancelada",
}

export function accreditationStatusBadgeVariant(status: string): "success" | "warning" | "danger" | "info" | "outline" {
  if (status === "approved") return "success"
  if (status === "submitted") return "info"
  if (status === "observed") return "warning"
  if (status === "expired") return "danger"
  return "outline"
}

export interface AccreditationRequirementRow {
  id: string
  code: string
  name: string
  appliesTo: string
  worksiteId: string | null
  relationship: string | null
  enforcement: string
  isActive: boolean
}

export interface AccreditationItemRow {
  requirementId: string
  contractId: string
  contractorWorkerId: string | null
  status: string
  expiresOn: string | null
}

export interface ContractRow {
  id: string
  code: string
  companyId: string
  worksiteId: string
  relationship: string
  status: string
}

export interface ContractorWorkerRow {
  id: string
  contractId: string
  rut: string
  firstName: string
  lastName: string
  status: string
}

export interface AccreditationGap {
  contractId: string
  contractCode: string
  worksiteId: string
  contractorWorkerId: string | null
  subjectLabel: string
  requirementId: string
  requirementCode: string
  requirementName: string
  enforcement: "blocking" | "warning"
  /** `missing` nunca se presentó · `observed` fue rechazado · `expired` caducó. */
  gapType: "missing" | "submitted_not_approved" | "observed" | "expired"
  expiresOn: string | null
}

/**
 * Un requisito alcanza a un contrato cuando su faena y su tipo de relación
 * coinciden. `worksiteId`/`relationship` nulos significan "cualquiera", no
 * "ninguno": son comodines deliberados para requisitos corporativos.
 */
function requirementAppliesToContract(requirement: AccreditationRequirementRow, contract: ContractRow) {
  if (!requirement.isActive) return false
  if (requirement.worksiteId && requirement.worksiteId !== contract.worksiteId) return false
  if (requirement.relationship && requirement.relationship !== contract.relationship) return false
  return true
}

function classify(item: AccreditationItemRow | undefined, asOf: string): AccreditationGap["gapType"] | null {
  if (!item) return "missing"
  if (item.status === "approved") {
    // Una fila aprobada con fecha pasada está vencida aunque el job todavía no
    // la haya marcado: la evidencia caducada no habilita el ingreso.
    if (item.expiresOn && item.expiresOn < asOf) return "expired"
    return null
  }
  if (item.status === "expired") return "expired"
  if (item.status === "observed") return "observed"
  if (item.status === "submitted") return "submitted_not_approved"
  return "missing"
}

/**
 * Cruza contratos vigentes × requisitos aplicables × evidencia presentada.
 * Los requisitos de alcance `worker` se evalúan por cada trabajador no
 * retirado; los de alcance `company`/`contract`, una vez por contrato.
 */
export function computeAccreditationGaps(args: {
  contracts: ContractRow[]
  workers: ContractorWorkerRow[]
  requirements: AccreditationRequirementRow[]
  items: AccreditationItemRow[]
  asOf: string
}): AccreditationGap[] {
  const itemKey = (requirementId: string, contractId: string, workerId: string | null) =>
    `${requirementId}::${contractId}::${workerId ?? ""}`
  const itemIndex = new Map(args.items.map((item) => [itemKey(item.requirementId, item.contractId, item.contractorWorkerId), item]))

  const workersByContract = new Map<string, ContractorWorkerRow[]>()
  for (const worker of args.workers) {
    const list = workersByContract.get(worker.contractId)
    if (list) list.push(worker)
    else workersByContract.set(worker.contractId, [worker])
  }

  const gaps: AccreditationGap[] = []
  for (const contract of args.contracts) {
    // Un contrato terminado ya no da acceso: no genera brecha accionable.
    if (contract.status === "finished") continue
    for (const requirement of args.requirements) {
      if (!requirementAppliesToContract(requirement, contract)) continue
      const enforcement: AccreditationGap["enforcement"] = requirement.enforcement === "blocking" ? "blocking" : "warning"

      if (requirement.appliesTo === "worker") {
        for (const worker of workersByContract.get(contract.id) ?? []) {
          if (worker.status === "withdrawn") continue
          const gapType = classify(itemIndex.get(itemKey(requirement.id, contract.id, worker.id)), args.asOf)
          if (!gapType) continue
          gaps.push({
            contractId: contract.id,
            contractCode: contract.code,
            worksiteId: contract.worksiteId,
            contractorWorkerId: worker.id,
            subjectLabel: `${worker.lastName}, ${worker.firstName} (${worker.rut})`,
            requirementId: requirement.id,
            requirementCode: requirement.code,
            requirementName: requirement.name,
            enforcement,
            gapType,
            expiresOn: itemIndex.get(itemKey(requirement.id, contract.id, worker.id))?.expiresOn ?? null,
          })
        }
        continue
      }

      const item = itemIndex.get(itemKey(requirement.id, contract.id, null))
      const gapType = classify(item, args.asOf)
      if (!gapType) continue
      gaps.push({
        contractId: contract.id,
        contractCode: contract.code,
        worksiteId: contract.worksiteId,
        contractorWorkerId: null,
        subjectLabel: contract.code,
        requirementId: requirement.id,
        requirementCode: requirement.code,
        requirementName: requirement.name,
        enforcement,
        gapType,
        expiresOn: item?.expiresOn ?? null,
      })
    }
  }
  return gaps
}

/**
 * Un contrato puede liberar acceso sólo si no tiene ninguna brecha bloqueante
 * a nivel de empresa o contrato. Las brechas de un trabajador concreto bloquean
 * a esa persona, no a todo el contrato: por eso se evalúan por separado.
 */
export function contractAccessDecision(args: {
  contractId: string
  gaps: AccreditationGap[]
}): { allowed: boolean; blockingGaps: AccreditationGap[] } {
  const blockingGaps = args.gaps.filter((gap) =>
    gap.contractId === args.contractId
    && gap.enforcement === "blocking"
    && gap.contractorWorkerId === null)
  return { allowed: blockingGaps.length === 0, blockingGaps }
}

export function workerAccessDecision(args: {
  contractId: string
  contractorWorkerId: string
  gaps: AccreditationGap[]
}): { allowed: boolean; blockingGaps: AccreditationGap[] } {
  const blockingGaps = args.gaps.filter((gap) =>
    gap.contractId === args.contractId
    && gap.enforcement === "blocking"
    && (gap.contractorWorkerId === null || gap.contractorWorkerId === args.contractorWorkerId))
  return { allowed: blockingGaps.length === 0, blockingGaps }
}
