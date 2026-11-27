import { and, eq, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantPartsNotes } from "@/db/schema"
import { logger } from "@/lib/logger"
import { viewerFromSession } from "../access"
import { NP_PERMISSIONS, noteVisibilitySql, type NoteVisibility } from "./access"
import { TAB_CONDITIONS } from "./list-filters"

/**
 * El número del menú «Notas de pedido» (decisión D34, ADR 0001), según lo que a cada persona le toca hacer con las notas. Si tiene
 * varios permisos manda el de mayor rango (`manage` > `purchase` > `view_own`):
 *
 * - `manage`: las notas por revisar de sus faenas. NO sale de aquí: es la fuente `mant_parts_note` de la cola de «Mis pendientes»
 *   (`work-queue-sources.ts`), que `getOperationalWorkCounts` ya cuenta.
 * - `purchase` (sin `manage`): las notas «En compra» de sus faenas: con alguna línea comprada que aún no está en una OC activa
 *   (lo que sigue por hacer en Compras). Es la pestaña «En compra» de la bandeja.
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
 * Las notas que cuenta el aviso de quien compra (`purchase` sin `manage`): sólo las de sus faenas, nunca las propias, y las de la
 * pestaña «En compra» de la bandeja (`TAB_CONDITIONS.en_compra`: una sola definición, así el número del menú y la pestaña no se separan).
 */
export function purchaseBadgeWhere(viewer: { isGlobal: boolean; worksiteIds: readonly string[] }) {
  const visibility: NoteVisibility = viewer.isGlobal ? { kind: "all" } : { kind: "scoped", worksiteIds: [...viewer.worksiteIds], ownUserId: null }
  return and(noteVisibilitySql(visibility), TAB_CONDITIONS.en_compra)
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
