/**
 * «De quién es esta faena» para la cola de «Mis pendientes» (brief
 * `docs/mantencion/brief-mis-pendientes.md` §3.3, opción B).
 *
 * Varias personas pueden resolver lo mismo (el jefe y el administrador de
 * contrato reciben el equipo; el jefe y el supervisor revisan registros; tres
 * roles resuelven notas de pedido). Con sólo «el permiso», la misma fila llegaría
 * a todos. La cola le ofrece cada fila a UN nivel: quien está más cerca de la
 * faena, y sube de nivel sólo cuando ese nivel no tiene a nadie.
 *
 * Módulo PURO, sin base de datos: recibe a los titulares ya leídos
 * (`queue-holders.ts`) y devuelve, para quien mira, qué faenas son suyas. Habla
 * de permisos y de alcance, nunca de nombres de rol: un rol personalizado de
 * `/admin/roles` funciona igual. La única excepción es el rol `administrador`,
 * que por diseño tiene TODOS los permisos y por eso no cuenta como responsable:
 * sólo recibe lo que nadie más puede resolver.
 */

/** Rol con todos los permisos de la plataforma. Los avisos de Mantención ya lo tratan aparte. */
export const ADMIN_ROLE = "administrador"

/**
 * - `local_first`: dueños son los titulares con alcance de esa faena; si no hay
 *   ninguno, suben los titulares globales; sólo si tampoco hay, el administrador.
 * - `global_first`: al revés. Los globales primero; los locales sólo si no hay
 *   ningún global.
 */
export type QueueDirection = "local_first" | "global_first"

export interface QueueHolder {
  userId: string
  /** Tiene el permiso por un rol que no es `administrador`, o por una concesión directa. */
  responsible: boolean
  /** Alguno de sus roles es global (ve todas las faenas). */
  isGlobal: boolean
  /** Faenas asignadas (`worksite_users`). Un global no las necesita. */
  worksiteIds: readonly string[]
}

export interface QueueViewer {
  userId: string
  isGlobal: boolean
  worksiteIds: readonly string[]
  /** Sólo tiene el permiso por el rol `administrador`. */
  adminOnly: boolean
}

/**
 * Qué faenas son de quien mira:
 * - `none`: ninguna, no se emite la fuente;
 * - `all`: todas;
 * - `only`: sólo éstas;
 * - `except`: todas menos éstas (las que ya cubre un nivel más cercano).
 */
export type OwnedWorksites =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "only"; worksiteIds: string[] }
  | { kind: "except"; worksiteIds: string[] }

/**
 * - `primary`: a quien mira le toca por ser el nivel más cercano.
 * - `fallback`: le toca porque el nivel más cercano no existe en esa faena.
 * - `last_resort`: es el administrador y nadie más puede resolverlo.
 */
export type OwnerTier = "primary" | "fallback" | "last_resort"

export interface OwnedResolution {
  worksites: OwnedWorksites
  tier: OwnerTier
}

const NONE: OwnedResolution = { worksites: { kind: "none" }, tier: "primary" }

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

/** Las faenas que cubre algún titular local. */
function coveredByLocals(locals: readonly QueueHolder[]): string[] {
  return unique(locals.flatMap((holder) => holder.worksiteIds))
}

/**
 * Las faenas de quien mira para un permiso y una dirección. Es la tabla del
 * brief §3.3 sin ramas escondidas:
 *
 * | quien mira          | `local_first`                  | `global_first`                         |
 * |---------------------|--------------------------------|----------------------------------------|
 * | sólo administrador  | si hay globales: ninguna; si no: faenas sin local | igual                |
 * | global              | faenas sin local               | todas                                  |
 * | local               | sus faenas                     | si hay globales: ninguna; si no: sus faenas |
 */
export function resolveOwnedWorksites(input: {
  viewer: QueueViewer
  /** Todos los titulares activos del permiso, también los que sólo lo tienen por `administrador`. */
  holders: readonly QueueHolder[]
  direction: QueueDirection
}): OwnedResolution {
  const { viewer, direction } = input
  const responsible = input.holders.filter((holder) => holder.responsible && holder.userId !== viewer.userId)
  // El que mira no se cuenta a sí mismo como «otro nivel»: si es local, sus faenas son suyas; si es
  // global, no tapa a los locales con su propia cobertura.
  const locals = responsible.filter((holder) => !holder.isGlobal)
  const globals = responsible.filter((holder) => holder.isGlobal)
  const localFaenas = coveredByLocals(locals)

  if (viewer.adminOnly) {
    if (globals.length > 0) return NONE
    return { worksites: { kind: "except", worksiteIds: localFaenas }, tier: "last_resort" }
  }

  if (viewer.isGlobal) {
    if (direction === "global_first") return { worksites: { kind: "all" }, tier: "primary" }
    return { worksites: { kind: "except", worksiteIds: localFaenas }, tier: "fallback" }
  }

  // Un titular local sin faenas asignadas no es dueño de nada.
  const own = unique(viewer.worksiteIds)
  if (own.length === 0) return NONE
  if (direction === "local_first") return { worksites: { kind: "only", worksiteIds: own }, tier: "primary" }
  if (globals.length > 0) return NONE
  return { worksites: { kind: "only", worksiteIds: own }, tier: "fallback" }
}

/** ¿La resolución deja alguna faena? Una fuente sin faenas no se emite. */
export function ownsAnyWorksite(resolution: OwnedResolution): boolean {
  const { worksites } = resolution
  return worksites.kind === "all" || worksites.kind === "except" || (worksites.kind === "only" && worksites.worksiteIds.length > 0)
}

/** ¿Esta faena es de quien mira? La misma regla que el SQL de la cola, para probarla sin base. */
export function ownsWorksite(resolution: OwnedResolution, worksiteId: string): boolean {
  const { worksites } = resolution
  switch (worksites.kind) {
    case "none": return false
    case "all": return true
    case "only": return worksites.worksiteIds.includes(worksiteId)
    case "except": return !worksites.worksiteIds.includes(worksiteId)
  }
}
