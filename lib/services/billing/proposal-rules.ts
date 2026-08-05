/**
 * lib/services/billing/proposal-rules.ts
 *
 * Reglas puras de las propuestas: máquina de estados y cálculo de totales.
 *
 * Vive separado de `proposals.ts` (que consulta la base) por una razón concreta:
 * el formulario de creación calcula el total en vivo **con esta misma función**,
 * y un Client Component no puede importar nada que arrastre `@/db` al bundle del
 * navegador. Compartir la fórmula en vez de duplicarla es lo que evita que la
 * cifra que el usuario ve y la que se guarda se separen con el tiempo.
 */

import { addAmounts, applyTaxRate, multiplyAmount, sumAmounts, taxRate } from "./money"

export type ProposalStatus =
  | "draft" | "in_review" | "observed" | "approved" | "ready"
  | "invoiced" | "closed" | "rejected" | "cancelled"

export type ProposalTransition =
  | "submit" | "observe" | "approve" | "reject" | "mark_ready" | "cancel" | "reopen"

/** Transiciones válidas. Cualquier otra combinación se rechaza. */
const TRANSITIONS: Record<ProposalTransition, { from: ProposalStatus[]; to: ProposalStatus }> = {
  submit:     { from: ["draft", "observed"],      to: "in_review" },
  observe:    { from: ["in_review"],              to: "observed" },
  approve:    { from: ["in_review"],              to: "approved" },
  reject:     { from: ["in_review", "observed"],  to: "rejected" },
  mark_ready: { from: ["approved"],               to: "ready" },
  cancel:     { from: ["draft", "observed", "in_review", "approved", "ready"], to: "cancelled" },
  reopen:     { from: ["observed", "rejected"],   to: "draft" },
}

/** Permiso exigido por transición. */
const TRANSITION_PERMISSION: Record<ProposalTransition, string> = {
  submit:     "billing:create_proposal",
  observe:    "billing:review_proposal",
  approve:    "billing:approve_proposal",
  reject:     "billing:approve_proposal",
  mark_ready: "billing:approve_proposal",
  cancel:     "billing:create_proposal",
  reopen:     "billing:create_proposal",
}

export interface TransitionContext {
  currentStatus: ProposalStatus
  transition: ProposalTransition
  permissions: readonly string[]
  actorUserId: string
  submittedBy: string | null
  createdBy: string | null
  missingDocuments: string | null
  reason?: string | null
}

export class ProposalTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProposalTransitionError"
  }
}

/**
 * Valida una transición. Es una función pura: la prueba unitaria la ejercita
 * sin base de datos, y la acción del servidor la llama antes de escribir.
 */
export function assertProposalTransition(context: TransitionContext): ProposalStatus {
  const rule = TRANSITIONS[context.transition]
  if (!rule) throw new ProposalTransitionError("Transición desconocida")

  if (!rule.from.includes(context.currentStatus)) {
    throw new ProposalTransitionError(
      `No se puede ${TRANSITION_LABELS[context.transition]} una propuesta en estado ${STATUS_LABELS[context.currentStatus]}`,
    )
  }

  const permission = TRANSITION_PERMISSION[context.transition]
  if (!context.permissions.includes(permission)) {
    throw new ProposalTransitionError("No tienes permisos para realizar esta acción")
  }

  // Segregación de funciones: quien envió a revisión no puede aprobar ni
  // rechazar su propia propuesta. Es el control que evita que una sola persona
  // prepare y autorice un cobro.
  if ((context.transition === "approve" || context.transition === "reject")) {
    const preparer = context.submittedBy ?? context.createdBy
    if (preparer && preparer === context.actorUserId) {
      throw new ProposalTransitionError(
        "La propuesta debe aprobarla una persona distinta de quien la preparó",
      )
    }
  }

  // Observar o rechazar exige decir por qué: sin motivo, quien preparó no sabe
  // qué corregir.
  if ((context.transition === "observe" || context.transition === "reject") && !context.reason?.trim()) {
    throw new ProposalTransitionError("Indica el motivo de la observación o del rechazo")
  }

  // No se declara lista una propuesta con antecedentes pendientes.
  if (context.transition === "mark_ready" && context.missingDocuments?.trim()) {
    throw new ProposalTransitionError(
      "La propuesta declara documentos faltantes: complétalos antes de marcarla lista para facturar",
    )
  }

  return rule.to
}

const TRANSITION_LABELS: Record<ProposalTransition, string> = {
  submit: "enviar a revisión", observe: "observar", approve: "aprobar",
  reject: "rechazar", mark_ready: "marcar lista", cancel: "anular", reopen: "reabrir",
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "borrador", in_review: "en revisión", observed: "observada", approved: "aprobada",
  ready: "lista para facturar", invoiced: "relacionada con factura", closed: "cerrada",
  rejected: "rechazada", cancelled: "anulada",
}

/* ── Totales ─────────────────────────────────────────────────────────────── */

export interface ProposalItemInput {
  description: string
  quantity: number
  unit?: string | null
  unitPrice: number
  isExempt?: boolean
}

export interface ProposalTotals {
  net: number
  tax: number
  total: number
  /** Neto exento: no paga IVA y se informa aparte. */
  exempt: number
}

/**
 * Recalcula los totales desde los ítems con aritmética exacta.
 * El IVA solo se aplica sobre la parte afecta.
 */
export function computeProposalTotals(items: readonly ProposalItemInput[]): ProposalTotals {
  const affectedNet = sumAmounts(
    items.filter((item) => !item.isExempt).map((item) => multiplyAmount(item.unitPrice, item.quantity)),
  )
  const exempt = sumAmounts(
    items.filter((item) => item.isExempt).map((item) => multiplyAmount(item.unitPrice, item.quantity)),
  )
  const tax = applyTaxRate(affectedNet, taxRate())
  return {
    net: addAmounts(affectedNet, exempt),
    tax,
    exempt,
    total: addAmounts(addAmounts(affectedNet, exempt), tax),
  }
}

