/**
 * lib/services/billing/pending.ts
 *
 * Detección de lo que corresponde facturar y todavía no se facturó.
 *
 * ## De dónde sale "pendiente de facturar"
 *
 * La plataforma **no tiene un módulo de órdenes de trabajo ni de servicios
 * ejecutados** (ver `docs/facturacion/AUDITORIA_ESTADO_ACTUAL.md` §5). Inventar
 * uno para llenar esta pantalla sería peor que no tenerla: mostraría trabajo que
 * nadie declaró. Así que el pendiente se deriva de dos hechos que la plataforma
 * sí conoce con certeza:
 *
 * 1. **Período de contrato sin cobrar.** Un contrato con ciclo mensual, vigente
 *    en ese mes, sin propuesta viva ni factura vinculada a ese período de
 *    servicio. Es el caso mayoritario de un contrato de servicios continuos.
 * 2. **Propuesta lista sin factura.** Alguien preparó y aprobó el cobro, pero
 *    todavía no aparece la factura emitida que lo respalde.
 *
 * Cada pendiente declara su `reason` y su `blocker`, así que nadie confunde
 * "falta emitir" con "faltan antecedentes".
 */

import type { Session } from "next-auth"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  billingInvoiceLinks,
  billingInvoices,
  billingProposals,
  clients,
  contracts,
  users,
  worksites,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { todayIso } from "./queries"

export type PendingKind = "contract_period" | "proposal_ready"

export interface PendingBillingItem {
  /** Clave estable del pendiente; sirve para enlazar y para deduplicar. */
  key: string
  kind: PendingKind
  clientId: string
  clientName: string
  contractId: string | null
  contractCode: string | null
  contractName: string | null
  worksiteId: string | null
  worksiteName: string | null
  /** Período de servicio "YYYY-MM". */
  period: string
  currency: string
  /** Monto esperado. Null cuando el contrato es de monto variable. */
  estimatedAmount: number | null
  clientPoNumber: string | null
  ownerUserId: string | null
  ownerName: string | null
  /** Días desde que el período terminó: la antigüedad del pendiente. */
  ageDays: number
  /** Por qué aparece acá. */
  reason: string
  /** Qué impide facturarlo hoy, si algo lo impide. */
  blocker: string | null
  /** Propuesta ya asociada, si existe. */
  proposalId: string | null
  proposalStatus: string | null
}

/** Cuántos meses hacia atrás se revisan contratos sin cobrar. */
const LOOKBACK_MONTHS = 6

/**
 * Pendientes de facturar visibles para la sesión.
 *
 * Respeta el alcance por faena: un rol acotado ve los contratos de sus faenas.
 * Un contrato transversal (sin faena) solo lo ve un rol global, porque no hay
 * forma de atribuirlo a un alcance acotado sin inventar una regla.
 */
export async function listPendingBilling(session: Session | null): Promise<PendingBillingItem[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []

  const today = todayIso()
  const currentPeriod = today.slice(0, 7)

  const contractRows = await db
    .select({
      id: contracts.id,
      code: contracts.code,
      name: contracts.name,
      clientId: contracts.clientId,
      clientName: clients.name,
      worksiteId: contracts.worksiteId,
      worksiteName: worksites.name,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      currency: contracts.currency,
      periodAmount: contracts.periodAmount,
      billingCycle: contracts.billingCycle,
      clientPoNumber: contracts.clientPoNumber,
      ownerUserId: contracts.ownerUserId,
      ownerName: users.name,
    })
    .from(contracts)
    .innerJoin(clients, eq(clients.id, contracts.clientId))
    .leftJoin(worksites, eq(worksites.id, contracts.worksiteId))
    .leftJoin(users, eq(users.id, contracts.ownerUserId))
    .where(and(
      eq(contracts.status, "active"),
      eq(contracts.billingCycle, "monthly"),
      ...(scope.mode === "some"
        ? [inArray(contracts.worksiteId, scope.ids)]
        : []),
    ))

  if (contractRows.length === 0) return []

  const contractIds = contractRows.map((row) => row.id)

  // Períodos ya cubiertos por una factura vinculada (no descartada).
  const invoicedRows = await db
    .select({
      contractId: billingInvoiceLinks.contractId,
      period: billingInvoiceLinks.servicePeriod,
    })
    .from(billingInvoiceLinks)
    .innerJoin(billingInvoices, eq(billingInvoices.id, billingInvoiceLinks.invoiceId))
    .where(and(
      inArray(billingInvoiceLinks.contractId, contractIds),
      ne(billingInvoiceLinks.status, "rejected"),
      ne(billingInvoices.documentStatus, "void"),
    ))

  const invoicedPeriods = new Set(
    invoicedRows
      .filter((row) => row.contractId && row.period)
      .map((row) => `${row.contractId}:${row.period}`),
  )

  // Propuestas vivas por contrato y período.
  const proposalRows = await db
    .select({
      id: billingProposals.id,
      contractId: billingProposals.contractId,
      period: billingProposals.servicePeriod,
      status: billingProposals.status,
      missingDocuments: billingProposals.missingDocuments,
      estimatedTotal: billingProposals.estimatedTotal,
      currency: billingProposals.currency,
      clientId: billingProposals.clientId,
      clientName: clients.name,
      worksiteId: billingProposals.worksiteId,
      worksiteName: worksites.name,
      clientPoNumber: billingProposals.clientPoNumber,
      ownerUserId: billingProposals.ownerUserId,
      ownerName: users.name,
    })
    .from(billingProposals)
    .innerJoin(clients, eq(clients.id, billingProposals.clientId))
    .leftJoin(worksites, eq(worksites.id, billingProposals.worksiteId))
    .leftJoin(users, eq(users.id, billingProposals.ownerUserId))
    .where(sql`${billingProposals.status} NOT IN ('rejected', 'cancelled', 'closed', 'invoiced')`)

  const proposalsByKey = new Map(
    proposalRows
      .filter((row) => row.contractId)
      .map((row) => [`${row.contractId}:${row.period}`, row]),
  )

  const items: PendingBillingItem[] = []

  // ── 1. Períodos de contrato sin cobrar ────────────────────────────────────
  for (const contract of contractRows) {
    for (const period of periodsToCheck(contract.startDate, contract.endDate, currentPeriod)) {
      const key = `${contract.id}:${period}`
      if (invoicedPeriods.has(key)) continue

      const proposal = proposalsByKey.get(key)
      // Con propuesta viva el pendiente existe igual, pero su bloqueo cambia:
      // ya no falta prepararlo, falta terminarlo o emitirlo.
      items.push({
        key: `contract:${key}`,
        kind: "contract_period",
        clientId: contract.clientId,
        clientName: contract.clientName,
        contractId: contract.id,
        contractCode: contract.code,
        contractName: contract.name,
        worksiteId: contract.worksiteId,
        worksiteName: contract.worksiteName,
        period,
        currency: contract.currency,
        estimatedAmount: proposal?.estimatedTotal ?? contract.periodAmount,
        clientPoNumber: contract.clientPoNumber,
        ownerUserId: contract.ownerUserId,
        ownerName: contract.ownerName,
        ageDays: daysSincePeriodEnd(period, today),
        reason: `Contrato mensual vigente sin factura para ${period}`,
        blocker: describeBlocker(proposal?.status ?? null, proposal?.missingDocuments ?? null),
        proposalId: proposal?.id ?? null,
        proposalStatus: proposal?.status ?? null,
      })
    }
  }

  // ── 2. Propuestas listas sin factura ──────────────────────────────────────
  const contractKeys = new Set(items.map((item) => item.key))
  for (const proposal of proposalRows) {
    if (proposal.status !== "approved" && proposal.status !== "ready") continue
    if (proposal.contractId && contractKeys.has(`contract:${proposal.contractId}:${proposal.period}`)) continue
    if (scope.mode === "some" && (!proposal.worksiteId || !scope.ids.includes(proposal.worksiteId))) continue

    items.push({
      key: `proposal:${proposal.id}`,
      kind: "proposal_ready",
      clientId: proposal.clientId,
      clientName: proposal.clientName,
      contractId: proposal.contractId,
      contractCode: null,
      contractName: null,
      worksiteId: proposal.worksiteId,
      worksiteName: proposal.worksiteName,
      period: proposal.period,
      currency: proposal.currency,
      estimatedAmount: proposal.estimatedTotal,
      clientPoNumber: proposal.clientPoNumber,
      ownerUserId: proposal.ownerUserId,
      ownerName: proposal.ownerName,
      ageDays: daysSincePeriodEnd(proposal.period, today),
      reason: "Propuesta aprobada sin factura emitida asociada",
      blocker: "Falta emitir el documento en el portal y relacionarlo con la propuesta",
      proposalId: proposal.id,
      proposalStatus: proposal.status,
    })
  }

  // Lo más antiguo primero: es lo que más urge cobrar.
  return items.sort((a, b) => b.ageDays - a.ageDays)
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Períodos a revisar de un contrato: desde su inicio (o `LOOKBACK_MONTHS` atrás,
 * lo que sea más reciente) hasta el mes anterior al actual.
 *
 * El mes en curso se excluye a propósito: un contrato mensual se factura cuando
 * el mes terminó, así que mostrarlo antes sería ruido garantizado.
 */
export function periodsToCheck(
  startDate: string | null,
  endDate: string | null,
  currentPeriod: string,
): string[] {
  const floor = shiftPeriod(currentPeriod, -LOOKBACK_MONTHS)
  const start = maxPeriod(startDate?.slice(0, 7) ?? floor, floor)
  const lastClosed = shiftPeriod(currentPeriod, -1)
  const end = minPeriod(endDate?.slice(0, 7) ?? lastClosed, lastClosed)

  const periods: string[] = []
  let cursor = start
  while (cursor <= end && periods.length <= LOOKBACK_MONTHS + 1) {
    periods.push(cursor)
    cursor = shiftPeriod(cursor, 1)
  }
  return periods
}

function describeBlocker(status: string | null, missingDocuments: string | null): string | null {
  if (!status) return "Falta preparar la propuesta de facturación"
  switch (status) {
    case "draft":     return "La propuesta está en borrador, sin enviar a revisión"
    case "in_review": return "La propuesta está en revisión"
    case "observed":  return missingDocuments
      ? `Propuesta observada: ${missingDocuments}`
      : "La propuesta fue observada y hay que corregirla"
    case "approved":
    case "ready":     return "Falta emitir el documento en el portal y relacionarlo"
    default:          return null
  }
}

export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function maxPeriod(a: string, b: string): string { return a > b ? a : b }
function minPeriod(a: string, b: string): string { return a < b ? a : b }

/** Días desde que terminó el período. Negativo si el período aún no cierra. */
export function daysSincePeriodEnd(period: string, today: string): number {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const end = Date.UTC(year, month, 0)  // último día del mes
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.round((now - end) / 86_400_000)
}
