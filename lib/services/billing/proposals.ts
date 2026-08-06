/**
 * lib/services/billing/proposals.ts
 *
 * Propuestas de facturación: la preparación interna de un cobro.
 *
 * ## Máquina de estados
 *
 * ```
 * draft ──▶ in_review ──▶ approved ──▶ ready ──▶ invoiced ──▶ closed
 *   ▲          │              │
 *   │          ▼              ▼
 *   └──── observed        rejected
 * ```
 *
 * Reglas que la implementación hace cumplir:
 *
 * - **Aprobar NO emite un DTE.** La emisión tributaria sigue siendo manual en el
 *   portal. `ready` significa "lista para que alguien la emita", no "emitida".
 * - **Quien prepara no aprueba.** Los permisos `create_proposal`,
 *   `review_proposal` y `approve_proposal` están separados, y además una persona
 *   no puede aprobar la propuesta que ella misma envió a revisión.
 * - **No se pasa a `ready` con antecedentes faltantes.** Si hay documentos
 *   pendientes declarados, la propuesta no puede declararse lista.
 * - Los totales se recalculan desde los ítems con aritmética exacta; no se
 *   confía en un total tecleado que no cuadre con sus líneas.
 */

import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  billingProposalItems,
  billingProposals,
  clients,
  contracts,
  users,
  worksites,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"

export * from "./proposal-rules"
import type { ProposalStatus } from "./proposal-rules"

/* ── Consultas ───────────────────────────────────────────────────────────── */

export interface ProposalListRow {
  id: string
  code: string
  clientName: string
  contractCode: string | null
  worksiteName: string | null
  servicePeriod: string
  currency: string
  estimatedTotal: number
  status: ProposalStatus
  ownerName: string | null
  approvedByName: string | null
  updatedAt: string
  itemCount: number
  missingDocuments: string | null
}

export async function listProposals(
  session: Session | null,
  filters: { status?: string; clientId?: string; period?: string } = {},
): Promise<ProposalListRow[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []

  const conditions = []
  if (filters.status) conditions.push(eq(billingProposals.status, filters.status as ProposalStatus))
  if (filters.clientId) conditions.push(eq(billingProposals.clientId, filters.clientId))
  if (filters.period) conditions.push(eq(billingProposals.servicePeriod, filters.period))
  if (scope.mode === "some") conditions.push(inArray(billingProposals.worksiteId, scope.ids))

  const rows = await db
    .select({
      id: billingProposals.id,
      code: billingProposals.code,
      clientName: clients.name,
      contractCode: contracts.code,
      worksiteName: worksites.name,
      servicePeriod: billingProposals.servicePeriod,
      currency: billingProposals.currency,
      estimatedTotal: billingProposals.estimatedTotal,
      status: billingProposals.status,
      ownerName: users.name,
      updatedAt: billingProposals.updatedAt,
      missingDocuments: billingProposals.missingDocuments,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM ${billingProposalItems}
        WHERE ${billingProposalItems.proposalId} = ${billingProposals.id}
      )`,
    })
    .from(billingProposals)
    .innerJoin(clients, eq(clients.id, billingProposals.clientId))
    .leftJoin(contracts, eq(contracts.id, billingProposals.contractId))
    .leftJoin(worksites, eq(worksites.id, billingProposals.worksiteId))
    .leftJoin(users, eq(users.id, billingProposals.ownerUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(billingProposals.servicePeriod), asc(billingProposals.code))

  return rows.map((row) => ({ ...row, status: row.status as ProposalStatus, approvedByName: null }))
}

export async function getProposalDetail(session: Session | null, proposalId: string) {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return null

  const rows = await db
    .select({
      proposal: billingProposals,
      clientName: clients.name,
      clientRut: clients.rut,
      contractCode: contracts.code,
      contractName: contracts.name,
      worksiteName: worksites.name,
    })
    .from(billingProposals)
    .innerJoin(clients, eq(clients.id, billingProposals.clientId))
    .leftJoin(contracts, eq(contracts.id, billingProposals.contractId))
    .leftJoin(worksites, eq(worksites.id, billingProposals.worksiteId))
    .where(eq(billingProposals.id, proposalId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (scope.mode === "some" && (!row.proposal.worksiteId || !scope.ids.includes(row.proposal.worksiteId))) {
    return null
  }

  const items = await db
    .select()
    .from(billingProposalItems)
    .where(eq(billingProposalItems.proposalId, proposalId))
    .orderBy(asc(billingProposalItems.sortOrder))

  return { ...row, items }
}

/* ── Código correlativo ──────────────────────────────────────────────────── */

/**
 * Genera el código de la propuesta ("PF-2026-0007").
 *
 * Usa el secuenciador central (`nextCodeTx`, sobre la SEQUENCE nativa de
 * Postgres) igual que el resto de los correlativos del sistema — SOL, OC, REC,
 * AJU, DEV. Antes contaba filas con `count(*) + 1`: bastaba con que se borrara
 * una propuesta para que el contador retrocediera y quedara colisionando de
 * forma permanente con un código ya emitido (H-11, AUDITORIA_BUGS_2026-08-05.md).
 *
 * Como toda reserva por SEQUENCE, un rollback consume el número y deja un hueco
 * en la serie. Es el mismo trade-off ya aceptado para OC y solicitudes: la
 * propuesta es un documento interno, no tributario.
 */
export async function nextProposalCode(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  year: number,
): Promise<string> {
  return nextCodeTx(executor, "PF", year)
}

export function newProposalId(): string {
  return nanoid()
}
