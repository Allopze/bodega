import { eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { mantPartsNotes } from "@/db/schema"
import { equipmentCurrentlyInWorksites, type MantViewer } from "../access"

/**
 * Alcance de las notas de pedido (NP), resuelto SIEMPRE en el servidor. La
 * navegación sólo lo refleja: ocultar un botón no es control de acceso.
 *
 * - Crear (`mant:np:create`): el mecánico asignado a la OT, o quien tiene
 *   `mant:ot:manage` con la faena en su alcance (ver `create.ts`); la NP sin OT,
 *   quien tiene `mant:np:create` en una faena de su alcance (`create-manual.ts`).
 * - Ver (`mant:np:view_worksite` o `mant:np:manage`): las NP de sus faenas; un rol
 *   global las ve todas. `mant:np:view_own` suma las que pidió él mismo.
 * - Resolver (`mant:np:manage`): lo mismo que ver, más el permiso. Reabrir
 *   (`mant:np:reopen`) y comprar (`mant:np:purchase`) siguen el mismo alcance.
 *
 * «Sus faenas» = la de la NP (la de la OT, que no se mueve) o la ACTUAL del
 * equipo (`fuel_vehicles.worksite_id`): la OT sigue al equipo trasladado, así que
 * quien recibe el equipo también revisa lo que se pidió para él.
 */

export const NP_PERMISSIONS = {
  create: "mant:np:create",
  viewWorksite: "mant:np:view_worksite",
  viewOwn: "mant:np:view_own",
  manage: "mant:np:manage",
  purchase: "mant:np:purchase",
  reopen: "mant:np:reopen",
  export: "mant:np:export",
} as const

export type NoteVisibility =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "scoped"; worksiteIds: string[]; ownUserId: string | null }

const has = (viewer: Pick<MantViewer, "permissions">, permission: string) => viewer.permissions.includes(permission)

export function noteVisibility(viewer: MantViewer): NoteVisibility {
  const ownUserId = has(viewer, NP_PERMISSIONS.viewOwn) ? viewer.userId : null
  // Comprar también abre la bandeja de sus faenas (`mant:np:purchase`): es lo que compra quien no resuelve.
  const seesWorksites = has(viewer, NP_PERMISSIONS.viewWorksite) || has(viewer, NP_PERMISSIONS.manage) || has(viewer, NP_PERMISSIONS.purchase)
  if (!seesWorksites) {
    return ownUserId ? { kind: "scoped", worksiteIds: [], ownUserId } : { kind: "none" }
  }
  if (viewer.isGlobal) return { kind: "all" }
  return { kind: "scoped", worksiteIds: [...viewer.worksiteIds], ownUserId }
}

/** Predicado SQL sobre `mant_parts_notes`. Sin permiso de NP: `false`. */
export function noteVisibilitySql(visibility: NoteVisibility): SQL {
  if (visibility.kind === "none") return sql`false`
  if (visibility.kind === "all") return sql`true`
  const parts: SQL[] = []
  if (visibility.worksiteIds.length) {
    parts.push(inArray(mantPartsNotes.worksiteId, visibility.worksiteIds))
    parts.push(equipmentCurrentlyInWorksites(mantPartsNotes.vehicleId, visibility.worksiteIds))
  }
  if (visibility.ownUserId) parts.push(eq(mantPartsNotes.requestedByUserId, visibility.ownUserId))
  return parts.length ? or(...parts)! : sql`false`
}

/** Lo que estas reglas leen de una NP: su faena, la faena actual de su equipo y quién la pidió. */
export interface NoteAccessFacts {
  worksiteId: string
  vehicleWorksiteId: string | null
  requestedByUserId?: string | null
}

export function canSeeNote(visibility: NoteVisibility, note: NoteAccessFacts): boolean {
  if (visibility.kind === "none") return false
  if (visibility.kind === "all") return true
  if (visibility.worksiteIds.includes(note.worksiteId)) return true
  if (note.vehicleWorksiteId && visibility.worksiteIds.includes(note.vehicleWorksiteId)) return true
  return !!visibility.ownUserId && note.requestedByUserId === visibility.ownUserId
}

export type NoteAccessCheck = { ok: true } | { ok: false; message: string }

/** Resolver, rechazar o anular: `mant:np:manage` y la faena de la NP en el alcance. */
export function canManageNote(viewer: MantViewer, note: { worksiteId: string; vehicleWorksiteId: string | null }): NoteAccessCheck {
  if (!has(viewer, NP_PERMISSIONS.manage)) return { ok: false, message: "No tienes permiso para resolver notas de pedido." }
  const scope = { kind: "scoped" as const, worksiteIds: viewer.isGlobal ? [] : [...viewer.worksiteIds], ownUserId: null }
  if (!viewer.isGlobal && !canSeeNote(scope, note)) return { ok: false, message: "Esta nota de pedido es de una faena que no es de tu alcance." }
  return { ok: true }
}

/** La faena está en el alcance del usuario (un rol global las tiene todas). */
export function inWorksiteScope(viewer: Pick<MantViewer, "isGlobal" | "worksiteIds">, worksiteId: string): boolean {
  return viewer.isGlobal || viewer.worksiteIds.includes(worksiteId)
}
