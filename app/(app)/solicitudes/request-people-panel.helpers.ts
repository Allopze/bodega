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
    jefe_terreno: "Jefe de terreno",
    supervisor_terreno: "Supervisor de terreno",
    prevencionista_faena: "Prevencionista de faena",
    // Roles que pueden figurar en decisiones históricas: sin entrada aquí el
    // panel mostraba el identificador crudo (`supervisor_faena`).
    supervisor_faena: "Supervisor de faena",
    solicitante_faena: "Solicitante de faena",
    conductor_lider: "Conductor líder",
    gerente_legal_rrhh: "Gerencia Legal y RR. HH.",
    subgerente_operaciones: "Subgerencia de operaciones",
    tecnico_ti: "Técnico TI",
    cphs: "Comité Paritario",
  }
  if (!roleContext) return "Rol no registrado"
  // Un rol desconocido nunca se muestra crudo: se legibiliza (snake_case → texto).
  return labels[roleContext] ?? (roleContext.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()))
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
