export interface RequestDecisionSummary {
  id: string
  type: string
  itemName: string
  decidedByName: string | null
  decidedByEmail: string | null
  roleContext: string | null
  decidedAt: string
  reason: string | null
  modifiedQty: number | null
}

export function personLabel(name: string | null | undefined, email: string | null | undefined) {
  return name?.trim() || email?.trim() || "No registrado"
}

export function decisionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    approve: "Aprobó",
    modify: "Aprobó con modificación",
    reject: "Rechazó",
    return: "Devolvió",
  }
  return labels[type] ?? type
}

export function roleContextLabel(roleContext: string | null) {
  const labels: Record<string, string> = {
    administrador: "Administrador",
    jefa_chome: "Jefatura",
    secretaria: "Secretaría",
    prevencionista: "Prevención",
    jefe_mantencion: "Jefe de mantención",
    admin_contrato: "Administrador de contrato",
    prevencionista_faena: "Prevencionista de faena",
  }
  if (!roleContext) return "Rol no registrado"
  return labels[roleContext] ?? roleContext
}

export function summarizeRequestPeople({
  requesterName,
  requesterEmail,
  decisions,
}: {
  requesterName: string | null | undefined
  requesterEmail: string | null | undefined
  decisions: RequestDecisionSummary[]
}) {
  const latestDecision = decisions[0]
  return {
    requester: personLabel(requesterName, requesterEmail),
    latestDecisionBy: latestDecision
      ? personLabel(latestDecision.decidedByName, latestDecision.decidedByEmail)
      : "Sin aprobación registrada",
    latestDecisionLabel: latestDecision ? decisionTypeLabel(latestDecision.type) : "Pendiente",
  }
}
