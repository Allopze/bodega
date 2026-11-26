import { inArray, or, sql, type SQL } from "drizzle-orm"
import { mantPartsNotes } from "@/db/schema"
import { equipmentCurrentlyInWorksites, type MantViewer } from "../access"

/**
 * Alcance de las notas de pedido (NP), resuelto SIEMPRE en el servidor. La
 * navegación sólo lo refleja: ocultar un botón no es control de acceso.
 *
 * - Crear (`mant:np:create`): el mecánico asignado a la OT, o quien tiene
 *   `mant:ot:manage` con la faena en su alcance (ver `create.ts`).
 * - Ver (`mant:np:view_worksite` o `mant:np:manage`): las NP de sus faenas; un rol
 *   global las ve todas.
 * - Resolver (`mant:np:manage`): lo mismo que ver, más el permiso.
 *
 * «Sus faenas» = la de la NP (la de la OT, que no se mueve) o la ACTUAL del
 * equipo (`fuel_vehicles.worksite_id`): la OT sigue al equipo trasladado, así que
 * quien recibe el equipo también revisa lo que se pidió para él.
 */

export const NP_PERMISSIONS = {
  create: "mant:np:create",
  viewWorksite: "mant:np:view_worksite",
  manage: "mant:np:manage",
} as const

export type NoteVisibility =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "scoped"; worksiteIds: string[] }

const has = (viewer: Pick<MantViewer, "permissions">, permission: string) => viewer.permissions.includes(permission)

export function noteVisibility(viewer: MantViewer): NoteVisibility {
  if (!has(viewer, NP_PERMISSIONS.viewWorksite) && !has(viewer, NP_PERMISSIONS.manage)) return { kind: "none" }
  if (viewer.isGlobal) return { kind: "all" }
  return { kind: "scoped", worksiteIds: [...viewer.worksiteIds] }
}

/** Predicado SQL sobre `mant_parts_notes`. Sin permiso de NP: `false`. */
export function noteVisibilitySql(visibility: NoteVisibility): SQL {
  if (visibility.kind === "none") return sql`false`
  if (visibility.kind === "all") return sql`true`
  if (visibility.worksiteIds.length === 0) return sql`false`
  return or(
    inArray(mantPartsNotes.worksiteId, visibility.worksiteIds),
    equipmentCurrentlyInWorksites(mantPartsNotes.vehicleId, visibility.worksiteIds),
  )!
}

/** Lo que estas reglas leen de una NP: su faena y la faena actual de su equipo. */
export interface NoteAccessFacts {
  worksiteId: string
  vehicleWorksiteId: string | null
}

export function canSeeNote(visibility: NoteVisibility, note: NoteAccessFacts): boolean {
  if (visibility.kind === "none") return false
  if (visibility.kind === "all") return true
  return visibility.worksiteIds.includes(note.worksiteId)
    || (!!note.vehicleWorksiteId && visibility.worksiteIds.includes(note.vehicleWorksiteId))
}

export type NoteAccessCheck = { ok: true } | { ok: false; message: string }

/** Resolver, rechazar o anular: `mant:np:manage` y la faena de la NP en el alcance. */
export function canManageNote(viewer: MantViewer, note: NoteAccessFacts): NoteAccessCheck {
  if (!has(viewer, NP_PERMISSIONS.manage)) return { ok: false, message: "No tienes permiso para resolver notas de pedido." }
  if (!canSeeNote(noteVisibility(viewer), note)) return { ok: false, message: "Esta nota de pedido es de una faena que no es de tu alcance." }
  return { ok: true }
}

/** La faena está en el alcance del usuario (un rol global las tiene todas). */
export function inWorksiteScope(viewer: Pick<MantViewer, "isGlobal" | "worksiteIds">, worksiteId: string): boolean {
  return viewer.isGlobal || viewer.worksiteIds.includes(worksiteId)
}
