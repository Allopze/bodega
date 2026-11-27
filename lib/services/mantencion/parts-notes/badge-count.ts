import { and, eq, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantPartsNoteItems, mantPartsNotes, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { pendingPurchaseWhere } from "@/lib/adquisiciones/pending-purchase"
import { logger } from "@/lib/logger"
import { viewerFromSession } from "../access"
import { NP_PERMISSIONS, noteVisibilitySql, type NoteVisibility } from "./access"

/**
 * El número del menú «Notas de pedido» (decisión D34, ADR 0001), según lo que a cada persona le toca hacer con las notas. Si tiene
 * varios permisos manda el de mayor rango (`manage` > `purchase` > `view_own`):
 *
 * - `manage`: las notas por revisar de sus faenas. NO sale de aquí: es la fuente `mant_parts_note` de la cola de «Mis pendientes»
 *   (`work-queue-sources.ts`), que `getOperationalWorkCounts` ya cuenta.
 * - `purchase` (sin `manage`): las notas «En compra» de sus faenas con alguna línea comprada que Compras todavía tiene que ordenar:
 *   un ítem aprobado (o devuelto a compra) de una solicitud no terminal y sin OC activa, es decir, lo que lista /compras
 *   (`pendingPurchaseWhere`). Es un SUBCONJUNTO de la pestaña «En compra» de la bandeja: la pestaña (`TAB_CONDITIONS.en_compra`) también
 *   incluye lo que aún espera su aprobación, que /compras no muestra todavía; el número del menú sigue a /compras, no a la pestaña.
 * - `view_own` (sin los otros): sus propias notas «En espera»: jefatura le pidió algo antes de seguir.
 *
 * Quien tiene sólo `view_worksite` no tiene nada que hacer con las notas: el número es 0.
 */
export type NotesBadgeTier = "manage" | "purchase" | "view_own"

export function partsNotesBadgeTier(permissions: readonly string[]): NotesBadgeTier | null {
  if (permissions.includes(NP_PERMISSIONS.manage)) return "manage"
  if (permissions.includes(NP_PERMISSIONS.purchase)) return "purchase"
  if (permissions.includes(NP_PERMISSIONS.viewOwn)) return "view_own"
  return null
}

/**
 * La nota tiene una línea «en compra» con un ítem de solicitud en la cola de Compras: el MISMO predicado que usa /compras
 * (`pendingPurchaseWhere`: ítem aprobado o `pending_purchase`, solicitud no terminal, ninguna OC activa que lo cubra), correlacionado
 * con `mant_parts_notes`. Una compra que aún espera aprobación (ítem `requested`) no cuenta: Compras no puede ordenarla.
 */
export const noteHasPendingPurchaseSql = sql`exists (
  select 1 from ${purchaseRequestItems}
  inner join ${purchaseRequests} on ${purchaseRequests.id} = ${purchaseRequestItems.requestId}
  inner join ${mantPartsNoteItems} on ${mantPartsNoteItems.id} = ${purchaseRequestItems.partsNoteItemId}
  where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id}
    and ${mantPartsNoteItems.resolution} = 'en_compra'
    and ${pendingPurchaseWhere()}
)`

/**
 * Las notas que cuenta el aviso de quien compra (`purchase` sin `manage`): sólo las de sus faenas, nunca las propias, en estado
 * «En compra» (la pestaña a la que lleva el aviso) y con algo que ordenar en Compras (`noteHasPendingPurchaseSql`).
 */
export function purchaseBadgeWhere(viewer: { isGlobal: boolean; worksiteIds: readonly string[] }) {
  const visibility: NoteVisibility = viewer.isGlobal ? { kind: "all" } : { kind: "scoped", worksiteIds: [...viewer.worksiteIds], ownUserId: null }
  return and(noteVisibilitySql(visibility), eq(mantPartsNotes.status, "en_compra"), noteHasPendingPurchaseSql)
}

/**
 * Cuántas notas cuenta el aviso para `purchase` o `view_own`. Degrada a 0 (con aviso en el registro) antes que tumbar el shell,
 * igual que el resto de `getOperationalWorkCounts`.
 */
export async function countPartsNotesForBadge(session: Session, tier: Exclude<NotesBadgeTier, "manage">): Promise<number> {
  const viewer = viewerFromSession(session)
  try {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(mantPartsNotes)
      .where(tier === "purchase" ? purchaseBadgeWhere(viewer) : and(eq(mantPartsNotes.status, "en_espera"), eq(mantPartsNotes.requestedByUserId, viewer.userId)))
    return Number(row?.total ?? 0)
  } catch (error) {
    logger.warn("Operational count of parts notes failed", {
      event: "operational_count_parts_notes_failed",
      tier,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}
