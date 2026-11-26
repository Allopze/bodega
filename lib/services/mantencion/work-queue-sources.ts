import { inArray, or, sql, type SQL } from "drizzle-orm"
import type { Session } from "next-auth"
import { mantPartsNoteItems, mantPartsNotes, mantRecords, mantWorkOrders, fuelVehicles, worksites } from "@/db/schema"
import { isGlobalRole } from "@/lib/auth/scope"
import {
  ADMIN_ROLE, ownsAnyWorksite, resolveOwnedWorksites,
  type OwnedResolution, type OwnedWorksites, type QueueDirection, type QueueHolder,
} from "@/lib/mantencion/queue-owners"
import { OT_STATUS_LABELS } from "@/lib/mantencion/work-order-states"
import { canActOnQueueSource, type WorkQueueSource } from "@/lib/services/work-queue-eligibility"
import { equipmentCurrentlyInWorksites } from "./access"
import { loadQueueHolders } from "./queue-holders"
import { vehicleNowInWorksitesSql } from "./work-orders/access"
import { partsPendingExistsSql } from "./work-orders/parts-requests"

/**
 * Mantención en «Mis pendientes» y en los avisos del menú (brief
 * `docs/mantencion/brief-mis-pendientes.md` §3.2). Siete tipos de fila en seis
 * fuentes, dentro de la misma unión de la cola (`operational-work-queue.ts`):
 *
 * | # | Fuente (`source_type` / `action_key`)   | Le toca a                                   |
 * |---|-----------------------------------------|---------------------------------------------|
 * | 1 | `mant_work_order` / `assign`            | quien gestiona OT (`mant:ot:manage`)        |
 * | 2 | `mant_work_order` / `receive`           | quien recibe el equipo (`mant:ot:receive`)  |
 * | 3 | `mant_work_order` / `conform`           | quien da la conformidad (`mant:ot:conform`) |
 * | 4 | `mant_work_order` / `start`             | el mecánico asignado                        |
 * | 5 | `mant_work_order` / `work`              | el mecánico asignado                        |
 * | 6 | `mant_parts_note` / `resolve`           | quien resuelve notas (`mant:np:manage`)     |
 * | 7 | `mant_records`    / `review` (por faena)| quien revisa registros (`mant:records:review`) |
 *
 * Cada fuente nace con el permiso de su ACCIÓN y sólo con ése (`canActOnQueueSource`).
 * Además las de reparto compartido (1, 2, 3, 6 y 7) se le ofrecen al nivel más cercano a
 * la faena (`lib/mantencion/queue-owners.ts`): así la misma nota no llega a tres personas
 * ni el jefe ve los 93 registros de las faenas que ya tienen supervisor.
 *
 * Regla de la propiedad que prueba la suite PGlite: toda fila entregada a una sesión es
 * una acción que el servicio acepta (`canActOnWorkOrder`, `canManageNote`,
 * `canActOnRecord`). Por eso cada predicado repite el alcance del servicio.
 */

export type MantencionQueueBranch = { module: "mantencion"; query: SQL }

type OwnerKey = "assign" | "receive" | "conform" | "review" | "notes"

interface OwnerSource {
  source: WorkQueueSource
  permission: string
  direction: QueueDirection
  /**
   * Por qué le llegó a quien mira cuando es el respaldo del nivel más cercano. Es lo que lee
   * el jefe para entender que ve registros de Cholguán. `null`: no hay un nivel más cercano
   * que explicar (el jefe es el dueño natural de asignar).
   */
  fallbackNotice: string | null
}

/** Lo que se muestra cuando el administrador recibe una fila: nadie más puede resolverla. */
export const LAST_RESORT_NOTICE = "Nadie más puede resolverlo en esta faena"

const OWNER_SOURCES: Record<OwnerKey, OwnerSource> = {
  assign: { source: "mant_ot_assign", permission: "mant:ot:manage", direction: "local_first", fallbackNotice: null },
  receive: { source: "mant_ot_receive", permission: "mant:ot:receive", direction: "local_first", fallbackNotice: "Sin administrador de contrato en la faena" },
  conform: { source: "mant_ot_conform", permission: "mant:ot:conform", direction: "local_first", fallbackNotice: null },
  review: { source: "mant_review", permission: "mant:records:review", direction: "local_first", fallbackNotice: "Sin supervisor en la faena" },
  notes: { source: "mant_np", permission: "mant:np:manage", direction: "global_first", fallbackNotice: "Sin jefatura de mantención activa" },
}
const OWNER_KEYS = Object.keys(OWNER_SOURCES) as OwnerKey[]

/** De cada reparto compartido: qué faenas son de quien mira. `null`: la sesión no tiene esa fuente. */
export type MantencionQueueOwnership = Record<OwnerKey, OwnedResolution | null>

export const EMPTY_OWNERSHIP: MantencionQueueOwnership = { assign: null, receive: null, conform: null, review: null, notes: null }

const has = (permissions: readonly string[], permission: string) => permissions.includes(permission)

/** ¿La sesión puede ofrecerse la fuente? Su permiso de acción y, para registros, ver los de la faena. */
function mayOwn(permissions: readonly string[], key: OwnerKey): boolean {
  if (!canActOnQueueSource(permissions, OWNER_SOURCES[key].source)) return false
  // `markRecordsReviewed` revisa sobre `canActOnRecord(recordVisibility(viewer))`: sin ver los registros de
  // la faena, el servicio responde «no encontrado». Ofrecer la fila sería prometer lo que se rechaza.
  if (key === "review") return has(permissions, "mant:records:view_all") || has(permissions, "mant:records:view_worksite")
  return true
}

/** ¿La sesión tiene «sus OT» (4 y 5)? No dependen de ninguna faena. */
export function hasMyWorkOrderSources(session: Session): boolean {
  return canActOnQueueSource(session.user.permissions ?? [], "mant_ot_execute")
}

/**
 * Resuelve, con UNA lectura de titulares, de quién es cada faena para esta sesión. Sin ninguno de los
 * cinco permisos de reparto no toca la base de datos.
 */
export async function loadMantencionQueueOwnership(session: Session): Promise<MantencionQueueOwnership> {
  const permissions = session.user.permissions ?? []
  const keys = OWNER_KEYS.filter((key) => mayOwn(permissions, key))
  if (keys.length === 0) return EMPTY_OWNERSHIP

  const holders = await loadQueueHolders(keys.map((key) => OWNER_SOURCES[key].permission))
  return resolveOwnership(session, keys, holders)
}

/** Parte pura de `loadMantencionQueueOwnership`: sin base de datos, para probarla sola. */
export function resolveOwnership(
  session: Session,
  keys: readonly OwnerKey[],
  holders: ReadonlyMap<string, readonly QueueHolder[]>,
): MantencionQueueOwnership {
  const result: MantencionQueueOwnership = { ...EMPTY_OWNERSHIP }
  const userId = session.user.id
  for (const key of keys) {
    const { permission, direction } = OWNER_SOURCES[key]
    const list = holders.get(permission) ?? []
    const self = list.find((holder) => holder.userId === userId)
    // Si la lectura no lo trae (sesión desfasada), manda el nombre del rol: sólo el administrador es «sin responsable».
    const adminOnly = self ? !self.responsible : (session.user.roles ?? []).includes(ADMIN_ROLE)
    result[key] = resolveOwnedWorksites({
      viewer: { userId, isGlobal: isGlobalRole(session), worksiteIds: session.user.worksiteIds ?? [], adminOnly },
      holders: list,
      direction,
    })
  }
  return result
}

// ── Predicados de faena ────────────────────────────────────────────────────

/** `inIds` arma «la faena está entre éstas» para cada fuente; aquí se resuelven `all`, `only` y `except`. */
function coverageSql(worksiteScope: OwnedWorksites, inIds: (ids: string[]) => SQL): SQL {
  switch (worksiteScope.kind) {
    case "none": return sql`false`
    case "all": return sql`true`
    case "only": return worksiteScope.worksiteIds.length > 0 ? inIds(worksiteScope.worksiteIds) : sql`false`
    case "except": return worksiteScope.worksiteIds.length > 0 ? sql`NOT (${inIds(worksiteScope.worksiteIds)})` : sql`true`
  }
}

/** Lo que dice la fila cuando llegó por escalamiento; `null` si le toca por ser el nivel más cercano. */
function noticeOf(key: OwnerKey, resolution: OwnedResolution): string | null {
  if (resolution.tier === "last_resort") return LAST_RESORT_NOTICE
  if (resolution.tier === "fallback") return OWNER_SOURCES[key].fallbackNotice
  return null
}

/** Subtítulo: lo propio de la fila y, si hay, por qué le llegó a esta persona. */
function subtitleSql(base: SQL | null, notice: string | null): SQL {
  if (base && notice) return sql`CONCAT_WS(' · ', ${base}, ${notice}::text)`
  if (base) return base
  return notice ? sql`${notice}::text` : sql`''::text`
}

/** «Reparación», «Mantención» o «Reparación y mantención» (las casillas del talonario). */
const kindLabelSql = sql`CASE
  WHEN ${mantWorkOrders.repair} AND ${mantWorkOrders.maintenance} THEN 'Reparación y mantención'
  WHEN ${mantWorkOrders.repair} THEN 'Reparación'
  ELSE 'Mantención' END`

/** Código del equipo tal como se firmó la OT: el texto de las filas y lo que busca la cola. */
const equipmentCodeSql = sql`COALESCE(NULLIF(${mantWorkOrders.equipmentSnapshot}->>'code', ''), NULLIF(${mantWorkOrders.equipmentSnapshot}->>'plate', ''), 'equipo')`

const label = (value: string): SQL => sql`${value}::text`
const otHref = sql`CONCAT('/mantencion/ot/', ${mantWorkOrders.id})`

// ── Las fuentes ────────────────────────────────────────────────────────────

/** Las 19 columnas de la proyección de la cola, en su orden. Cada fuente sólo pone lo que cambia. */
function projection(columns: {
  sourceType: string
  sourceId: SQL
  actionKey: string
  code: SQL
  title: SQL
  subtitle: SQL
  worksiteId: SQL
  worksiteName: SQL
  status: SQL
  statusLabel: SQL
  priority: SQL
  blocked: SQL
  createdAt: SQL
  sourceDueAt: SQL
  href: SQL
  ctaLabel: string
}): SQL {
  return sql`
    SELECT ${label(columns.sourceType)} AS source_type, ${columns.sourceId} AS source_id, ${label(columns.actionKey)} AS action_key,
      'mantencion'::text AS module, ${columns.code} AS code, ${columns.title} AS title, ${columns.subtitle} AS subtitle,
      ${columns.worksiteId} AS worksite_id, ${columns.worksiteName} AS worksite_name,
      ${columns.status} AS status, ${columns.statusLabel} AS status_label, ${columns.priority} AS priority, ${columns.blocked} AS blocked,
      ${columns.createdAt} AS created_at, ${columns.sourceDueAt} AS source_due_at,
      NULL::text AS native_assignee_user_id, NULL::text AS native_assignee_name,
      ${columns.href} AS href, ${label(columns.ctaLabel)} AS cta_label`
}

const NORMAL = sql`'normal'::text`
const NO_DATE = sql`NULL::text`
const NOT_BLOCKED = sql`false`

/** 1. OT por asignar: `solicitada`. La faena es la de imputación o aquella donde hoy está el equipo. */
function assignBranch(resolution: OwnedResolution): SQL {
  const owned = coverageSql(resolution.worksites, (ids) => or(inArray(mantWorkOrders.worksiteId, ids), vehicleNowInWorksitesSql(ids))!)
  return sql`${projection({
    sourceType: "mant_work_order", sourceId: sql`${mantWorkOrders.id}`, actionKey: "assign", code: sql`${mantWorkOrders.folio}`,
    title: sql`CONCAT('Asignar mecánico a ', ${equipmentCodeSql})`,
    subtitle: subtitleSql(kindLabelSql, noticeOf("assign", resolution)),
    worksiteId: sql`${mantWorkOrders.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`${mantWorkOrders.status}`, statusLabel: label(OT_STATUS_LABELS.solicitada),
    priority: NORMAL, blocked: NOT_BLOCKED, createdAt: sql`${mantWorkOrders.createdAt}::text`, sourceDueAt: NO_DATE,
    href: otHref, ctaLabel: "Asignar mecánico",
  })}
    FROM ${mantWorkOrders}
    INNER JOIN ${worksites} ON ${worksites.id} = ${mantWorkOrders.worksiteId}
    WHERE ${mantWorkOrders.status} = 'solicitada' AND ${owned}`
}

/**
 * 2 y 3. Recepción y conformidad: la OT sigue al equipo, así que la faena es la ACTUAL del equipo
 * (`fuel_vehicles.worksite_id`), como `WORKSITE_SCOPED` en `canActOnWorkOrder`. Una OT imputada a
 * una faena con el equipo ya trasladado a otra va al destino.
 */
function atEquipmentBranch(
  key: "receive" | "conform",
  resolution: OwnedResolution,
  spec: { status: "trabajo_terminado" | "recepcionada"; actionKey: string; title: SQL; ctaLabel: string; since: SQL },
): SQL {
  const owned = coverageSql(resolution.worksites, (ids) => inArray(fuelVehicles.worksiteId, ids))
  return sql`${projection({
    sourceType: "mant_work_order", sourceId: sql`${mantWorkOrders.id}`, actionKey: spec.actionKey, code: sql`${mantWorkOrders.folio}`,
    title: spec.title,
    subtitle: subtitleSql(kindLabelSql, noticeOf(key, resolution)),
    worksiteId: sql`${fuelVehicles.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`${mantWorkOrders.status}`, statusLabel: label(OT_STATUS_LABELS[spec.status]),
    priority: NORMAL, blocked: NOT_BLOCKED, createdAt: sql`COALESCE(${spec.since}, ${mantWorkOrders.createdAt})::text`, sourceDueAt: NO_DATE,
    href: otHref, ctaLabel: spec.ctaLabel,
  })}
    FROM ${mantWorkOrders}
    INNER JOIN ${fuelVehicles} ON ${fuelVehicles.id} = ${mantWorkOrders.vehicleId}
    INNER JOIN ${worksites} ON ${worksites.id} = ${fuelVehicles.worksiteId}
    WHERE ${mantWorkOrders.status} = ${spec.status} AND ${owned}`
}

/** 4. Mi OT por ingresar: `asignada` a mí. Sin faena: el mecánico ejecuta OT de cualquier faena. */
function myStartBranch(userId: string): SQL {
  return sql`${projection({
    sourceType: "mant_work_order", sourceId: sql`${mantWorkOrders.id}`, actionKey: "start", code: sql`${mantWorkOrders.folio}`,
    title: sql`CONCAT('Ingresar ', ${equipmentCodeSql}, ' a taller')`,
    subtitle: subtitleSql(kindLabelSql, null),
    worksiteId: sql`${mantWorkOrders.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`${mantWorkOrders.status}`, statusLabel: label(OT_STATUS_LABELS.asignada),
    priority: NORMAL, blocked: NOT_BLOCKED, createdAt: sql`COALESCE(${mantWorkOrders.assignedAt}, ${mantWorkOrders.createdAt})::text`, sourceDueAt: NO_DATE,
    href: otHref, ctaLabel: "Ingresar a taller",
  })}
    FROM ${mantWorkOrders}
    INNER JOIN ${worksites} ON ${worksites.id} = ${mantWorkOrders.worksiteId}
    WHERE ${mantWorkOrders.status} = 'asignada' AND ${mantWorkOrders.assignedToUserId} = ${userId}`
}

/**
 * 5. Mi OT en taller: `en_ejecucion` a mí. Vence en la entrega estimada (obligatoria desde que entra a taller).
 * Devuelta por la recepción o por la conformidad sube a `high`; con repuestos pedidos que no llegan está bloqueada.
 * El estado cambia de valor y de rótulo juntos, para que el filtro de estados no repita un mismo valor con dos textos.
 */
function myWorkBranch(userId: string, canRegisterWork: boolean): SQL {
  const rejected = sql`${mantWorkOrders.rejectionCount} > 0`
  const waiting = partsPendingExistsSql(mantWorkOrders.id)
  return sql`${projection({
    sourceType: "mant_work_order", sourceId: sql`${mantWorkOrders.id}`, actionKey: "work", code: sql`${mantWorkOrders.folio}`,
    title: sql`CONCAT('Trabajar en ', ${equipmentCodeSql})`,
    subtitle: subtitleSql(kindLabelSql, null),
    worksiteId: sql`${mantWorkOrders.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`CASE WHEN ${rejected} THEN 'devuelta_a_taller' WHEN ${waiting} THEN 'esperando_repuestos' ELSE ${mantWorkOrders.status} END`,
    statusLabel: sql`CASE WHEN ${rejected} THEN 'Devuelta a taller' WHEN ${waiting} THEN 'Esperando repuestos' ELSE ${label(OT_STATUS_LABELS.en_ejecucion)} END`,
    priority: sql`CASE WHEN ${rejected} THEN 'high'::text ELSE 'normal'::text END`,
    blocked: waiting,
    createdAt: sql`COALESCE(${mantWorkOrders.startedAt}, ${mantWorkOrders.createdAt})::text`,
    sourceDueAt: sql`LEFT(${mantWorkOrders.estimatedDeliveryDate}, 10)`,
    // «Registrar trabajo» firma la correctiva desde la ficha y pide `mant:app:use` (`canRegisterWorkOrderRecord`): quien no la
    // tiene aún puede terminar la OT, pero la fila no le promete el registro.
    href: otHref, ctaLabel: canRegisterWork ? "Registrar trabajo" : "Abrir orden",
  })}
    FROM ${mantWorkOrders}
    INNER JOIN ${worksites} ON ${worksites.id} = ${mantWorkOrders.worksiteId}
    WHERE ${mantWorkOrders.status} = 'en_ejecucion' AND ${mantWorkOrders.assignedToUserId} = ${userId}`
}

/**
 * 6. Nota de pedido por resolver: no anulada y con al menos una línea `pendiente` (`enviada` + `en_gestion`). La faena
 * es la de la nota o aquella donde hoy está el equipo (`noteVisibilitySql`).
 */
function notesBranch(resolution: OwnedResolution): SQL {
  const owned = coverageSql(resolution.worksites, (ids) => or(inArray(mantPartsNotes.worksiteId, ids), equipmentCurrentlyInWorksites(mantPartsNotes.vehicleId, ids))!)
  const notice = noticeOf("notes", resolution)
  return sql`${projection({
    sourceType: "mant_parts_note", sourceId: sql`${mantPartsNotes.id}`, actionKey: "resolve", code: sql`${mantPartsNotes.code}`,
    title: sql`CONCAT('Resolver repuestos de ', ${equipmentCodeSql})`,
    subtitle: sql`CONCAT_WS(' · ', CONCAT('OT ', ${mantWorkOrders.folio}), CONCAT(note_lines.pending_count, ' por resolver'),
      CASE WHEN ${mantPartsNotes.equipmentStopped} THEN 'equipo detenido' END${notice ? sql`, ${notice}::text` : sql``})`,
    worksiteId: sql`${mantPartsNotes.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`${mantPartsNotes.status}`,
    statusLabel: sql`CASE ${mantPartsNotes.status} WHEN 'en_gestion' THEN 'En gestión' ELSE 'Pendiente' END`,
    priority: sql`CASE WHEN ${mantPartsNotes.equipmentStopped} THEN 'high'::text ELSE 'normal'::text END`,
    blocked: NOT_BLOCKED, createdAt: sql`${mantPartsNotes.createdAt}::text`, sourceDueAt: NO_DATE,
    href: sql`CONCAT('/mantencion/notas-pedido/', ${mantPartsNotes.id})`, ctaLabel: "Resolver nota",
  })}
    FROM ${mantPartsNotes}
    INNER JOIN ${mantWorkOrders} ON ${mantWorkOrders.id} = ${mantPartsNotes.workOrderId}
    INNER JOIN ${worksites} ON ${worksites.id} = ${mantPartsNotes.worksiteId}
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS pending_count FROM ${mantPartsNoteItems}
      WHERE ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} AND ${mantPartsNoteItems.resolution} = 'pendiente'
    ) AS note_lines
    WHERE ${mantPartsNotes.status} <> 'anulada' AND note_lines.pending_count > 0 AND ${owned}`
}

/**
 * Los registros que esta sesión debe revisar, POR REGISTRO: vigentes, pendientes, de una faena suya y no firmados ni
 * ejecutados por ella (la regla de `markRecordReviewed`: nadie revisa lo propio). Es la única definición: la fila
 * agregada de la cola y el aviso del menú (que cuenta registros, no filas) salen de aquí.
 */
export function reviewableRecordsWhere(userId: string, resolution: OwnedResolution): SQL {
  const owned = coverageSql(resolution.worksites, (ids) => inArray(mantRecords.worksiteId, ids))
  return sql`${mantRecords.status} = 'vigente' AND ${mantRecords.review} = 'pendiente' AND ${owned}
    AND ${mantRecords.registeredBy} <> ${userId}
    AND (${mantRecords.executorUserId} IS NULL OR ${mantRecords.executorUserId} <> ${userId})`
}

/** 7. Registros por revisar: UNA fila por faena (la revisión real es en lote) con el conteo en el título. */
function recordsBranch(userId: string, resolution: OwnedResolution): SQL {
  return sql`${projection({
    sourceType: "mant_records", sourceId: sql`${mantRecords.worksiteId}`, actionKey: "review", code: sql`NULL::text`,
    title: sql`CONCAT('Revisar ', COUNT(*), CASE WHEN COUNT(*) = 1 THEN ' registro' ELSE ' registros' END, ' de mantención')`,
    subtitle: subtitleSql(null, noticeOf("review", resolution)),
    worksiteId: sql`${mantRecords.worksiteId}`, worksiteName: sql`${worksites.name}`,
    status: sql`'por_revisar'::text`, statusLabel: label("Por revisar"),
    priority: NORMAL, blocked: NOT_BLOCKED, createdAt: sql`MIN(${mantRecords.receivedAt})::text`, sourceDueAt: NO_DATE,
    href: sql`CONCAT('/mantencion/registros?revision=pendiente&estado=vigente&faena=', ${mantRecords.worksiteId})`, ctaLabel: "Revisar registros",
  })}
    FROM ${mantRecords}
    INNER JOIN ${worksites} ON ${worksites.id} = ${mantRecords.worksiteId}
    WHERE ${reviewableRecordsWhere(userId, resolution)}
    GROUP BY ${mantRecords.worksiteId}, ${worksites.name}`
}

/**
 * Las ramas de Mantención de esta sesión. Una fuente que la sesión no tiene, o cuya regla de dueño le deja
 * «ninguna faena», no se agrega: ni sale en la cola ni cuesta una consulta.
 */
export function mantencionSourceBranches(session: Session, ownership: MantencionQueueOwnership): MantencionQueueBranch[] {
  const permissions = session.user.permissions ?? []
  const userId = session.user.id
  const branches: MantencionQueueBranch[] = []
  const add = (query: SQL) => branches.push({ module: "mantencion", query })

  const owned = (key: OwnerKey): OwnedResolution | null => {
    const resolution = ownership[key]
    return resolution && mayOwn(permissions, key) && ownsAnyWorksite(resolution) ? resolution : null
  }

  const assign = owned("assign")
  if (assign) add(assignBranch(assign))
  const receive = owned("receive")
  if (receive) {
    add(atEquipmentBranch("receive", receive, {
      status: "trabajo_terminado", actionKey: "receive", title: sql`CONCAT('Recibir ', ${equipmentCodeSql}, ' del taller')`,
      ctaLabel: "Registrar recepción", since: sql`${mantWorkOrders.finishedAt}`,
    }))
  }
  const conform = owned("conform")
  if (conform) {
    add(atEquipmentBranch("conform", conform, {
      status: "recepcionada", actionKey: "conform", title: sql`CONCAT('Dar conformidad por ', ${equipmentCodeSql})`,
      ctaLabel: "Dar conformidad", since: sql`${mantWorkOrders.receivedRecordedAt}`,
    }))
  }
  if (hasMyWorkOrderSources(session)) {
    add(myStartBranch(userId))
    add(myWorkBranch(userId, has(permissions, "mant:app:use")))
  }
  const notes = owned("notes")
  if (notes) add(notesBranch(notes))
  const review = owned("review")
  if (review) add(recordsBranch(userId, review))
  return branches
}

/** Lo que el aviso de «Registros firmados» cuenta: los registros de `reviewableRecordsWhere`, o `null` si la sesión no revisa. */
export function mantencionRecordsToReviewWhere(session: Session, ownership: MantencionQueueOwnership): SQL | null {
  const resolution = ownership.review
  if (!resolution || !mayOwn(session.user.permissions ?? [], "review") || !ownsAnyWorksite(resolution)) return null
  return reviewableRecordsWhere(session.user.id, resolution)
}
