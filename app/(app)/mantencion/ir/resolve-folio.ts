import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, mantPartsNotes, mantRecords, mantWorkOrders } from "@/db/schema"
import { canSeeRecord, recordVisibility, type MantViewer } from "@/lib/services/mantencion/access"
import { canSeeNote, noteVisibility } from "@/lib/services/mantencion/parts-notes/access"
import { canSeeWorkOrder, workOrderVisibility } from "@/lib/services/mantencion/work-orders/access"
import type { Permission } from "@/modules/permissions"

/**
 * Resolver de folios de Mantención (`/mantencion/ir?folio=OT-BIO-0001`): del folio impreso en el papel, el PDF o
 * la conversación a la ficha del registro. Lo usan la paleta de comandos (atajos `OT-`, `MP-`, `MC-`, `NP-`) y
 * cualquier enlace que sólo conozca el folio.
 *
 * Es navegación, no una vista nueva de los datos: SIEMPRE con las mismas reglas de visibilidad que el detalle
 * (`canSeeWorkOrder`, `canSeeRecord`, `canSeeNote`, sobre la faena de la fila y la ACTUAL del equipo). Un folio que
 * existe pero no es del alcance de la persona da el mismo resultado que uno que no existe, y la ficha a la que se
 * redirige vuelve a pedir su permiso y su alcance.
 */

export type FolioKind = "ot" | "registro" | "nota"

interface FolioKindInfo {
  /** Lista a la que llevar cuando el folio no se encuentra. */
  listHref: string
  listLabel: string
  /** Los permisos con los que su ficha deja entrar (cualquiera basta): los mismos que exige su página. */
  permissions: Permission[]
  /** Ruta de su ficha; se le agrega `/<id>`. */
  detailBase: string
}

export const FOLIO_KINDS: Record<FolioKind, FolioKindInfo> = {
  ot: {
    listHref: "/mantencion/ot",
    listLabel: "Órdenes de trabajo",
    permissions: ["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"],
    detailBase: "/mantencion/ot",
  },
  registro: {
    listHref: "/mantencion/registros",
    listLabel: "Registros firmados",
    permissions: ["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"],
    detailBase: "/mantencion/registros",
  },
  nota: {
    listHref: "/mantencion/notas-pedido",
    listLabel: "Notas de pedido",
    permissions: ["mant:np:view_worksite", "mant:np:manage"],
    detailBase: "/mantencion/notas-pedido",
  },
}

const KIND_ORDER: FolioKind[] = ["ot", "registro", "nota"]

/** Los permisos de vista de Mantención: la página exige al menos uno. Cada tipo de folio vuelve a pedir el suyo. */
export const FOLIO_VIEW_PERMISSIONS: Permission[] = KIND_ORDER.flatMap((kind) => FOLIO_KINDS[kind].permissions)

const MAX_FOLIO_LENGTH = 64

/** El folio como se guarda: sin espacios a los lados y en mayúsculas. Acepta el valor crudo de `searchParams`. */
export function normalizeFolio(raw: string | readonly string[] | undefined | null): string {
  const value = typeof raw === "string" ? raw : raw?.[0]
  return (value ?? "").trim().toUpperCase().slice(0, MAX_FOLIO_LENGTH)
}

/**
 * De qué tipo puede ser el folio, por su prefijo: `OT-` orden de trabajo, `MP-`/`MC-` registro firmado
 * (preventiva y correctiva), `NP-` nota de pedido. Sin un prefijo conocido se prueban los tres.
 */
export function folioKindsFor(folio: string): FolioKind[] {
  if (folio.startsWith("OT-")) return ["ot"]
  if (folio.startsWith("MP-") || folio.startsWith("MC-")) return ["registro"]
  if (folio.startsWith("NP-")) return ["nota"]
  return folio ? KIND_ORDER : []
}

/** ¿Tiene algún permiso con el que se abre la ficha de este tipo? Sin él ni se consulta: no hay nada que revelar. */
export function canOpenKind(viewer: Pick<MantViewer, "permissions">, kind: FolioKind): boolean {
  return FOLIO_KINDS[kind].permissions.some((permission) => viewer.permissions.includes(permission))
}

/**
 * La lista a la que llevar a quien no encontró su folio: la del tipo que sugiere el prefijo si puede abrirla, y si no,
 * la primera de Mantención que sí puede abrir. `null` sólo si no puede abrir ninguna (la página ya lo habría negado).
 */
export function listFor(viewer: Pick<MantViewer, "permissions">, folio: string): { href: string; label: string } | null {
  const byPrefix = folioKindsFor(folio)
  const hinted = byPrefix.length === 1 ? byPrefix : []
  const kind = [...hinted, ...KIND_ORDER].find((candidate) => canOpenKind(viewer, candidate))
  return kind ? { href: FOLIO_KINDS[kind].listHref, label: FOLIO_KINDS[kind].listLabel } : null
}

async function findWorkOrderId(viewer: MantViewer, folio: string): Promise<string | null> {
  const [row] = await db
    .select({
      id: mantWorkOrders.id,
      status: mantWorkOrders.status,
      worksiteId: mantWorkOrders.worksiteId,
      requestedByUserId: mantWorkOrders.requestedByUserId,
      assignedToUserId: mantWorkOrders.assignedToUserId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .where(eq(mantWorkOrders.folio, folio))
    .limit(1)
  return row && canSeeWorkOrder(workOrderVisibility(viewer), row) ? row.id : null
}

async function findRecordId(viewer: MantViewer, folio: string): Promise<string | null> {
  const [row] = await db
    .select({
      id: mantRecords.id,
      worksiteId: mantRecords.worksiteId,
      registeredBy: mantRecords.registeredBy,
      executorUserId: mantRecords.executorUserId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantRecords)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .where(eq(mantRecords.folio, folio))
    .limit(1)
  return row && canSeeRecord(recordVisibility(viewer), row) ? row.id : null
}

async function findNoteId(viewer: MantViewer, folio: string): Promise<string | null> {
  const [row] = await db
    .select({
      id: mantPartsNotes.id,
      worksiteId: mantPartsNotes.worksiteId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantPartsNotes)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(eq(mantPartsNotes.code, folio))
    .limit(1)
  return row && canSeeNote(noteVisibility(viewer), row) ? row.id : null
}

const FINDERS: Record<FolioKind, (viewer: MantViewer, folio: string) => Promise<string | null>> = {
  ot: findWorkOrderId,
  registro: findRecordId,
  nota: findNoteId,
}

/**
 * La ficha del folio, o `null` si no existe o no es del alcance de la persona (no se distingue). `folio` ya
 * normalizado (`normalizeFolio`).
 */
export async function resolveFolio(viewer: MantViewer, folio: string): Promise<{ kind: FolioKind; href: string } | null> {
  for (const kind of folioKindsFor(folio)) {
    if (!canOpenKind(viewer, kind)) continue
    const id = await FINDERS[kind](viewer, folio)
    if (id) return { kind, href: `${FOLIO_KINDS[kind].detailBase}/${encodeURIComponent(id)}` }
  }
  return null
}
