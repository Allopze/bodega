import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantWorkOrders } from "@/db/schema"
import {
  MANT_WEB_APP_VERSION, MANT_WEB_DEVICE_ID, MANT_WEB_PHOTO_TYPES, syncRecordSchema, webMetaField, webPhotoField,
  type CatalogEquipment, type SyncRecord, type SyncWarning,
} from "@/lib/mantencion/contracts"
import type { MantScheduleSnapshot } from "@/lib/mantencion/types"
import { viewerFromSession, type MantViewer } from "./access"
import { toCatalogEquipment } from "./catalog"
import { listMantCatalogs } from "./catalogs"
import { loadFleet } from "./fleet"
import { savePhoto } from "./photos"
import { createRecord } from "./records-create"
import { getCurrentScheduleSnapshots } from "./schedule-versions"
import { findAppUsers } from "./sync-app-users"
import type { SyncContext } from "./sync-auth"
import { canRegisterWorkOrderRecord } from "./work-orders/access"

/**
 * Registro de la correctiva o preventiva de una OT desde el PC (la ficha de la
 * OT), con la sesión del navegador en vez de la credencial del teléfono.
 *
 * No es un camino paralelo: arma el mismo `SyncContext` que la sincronización
 * y pasa por `savePhoto` y `createRecord`, así que valida exactamente igual
 * (lectura, pauta, catálogos, fotos, enlace con la OT) y es idempotente por los
 * mismos ids: el del registro nace al abrir el formulario y el de cada foto al
 * cargarla. Lo único que el servidor impone por su cuenta es lo que el PC no
 * puede acreditar: la hora de la firma (la del servidor, por si el reloj del PC
 * está atrasado), «firmado con señal», el dispositivo y la versión «web».
 */

export { MANT_WEB_APP_VERSION, MANT_WEB_DEVICE_ID }

export function webSyncContext(session: Session): SyncContext {
  return {
    viewer: viewerFromSession(session),
    userName: session.user.name ?? session.user.email ?? "Usuario",
    deviceId: MANT_WEB_DEVICE_ID,
    credentialId: "web",
  }
}

type Named = { id: string; name: string }

/** Lo que el formulario necesita del equipo y de los catálogos; se carga sólo si quien mira puede registrar. */
export interface WorkOrderRecordForm {
  equipment: CatalogEquipment
  /** Pauta vigente del equipo; `null` = sin pauta (no hay preventiva). */
  schedule: MantScheduleSnapshot | null
  /** Faenas de quien registra: el equipo de otra faena sólo se marca, no se bloquea. */
  worksiteIds: string[]
  workTypes: Named[]
  oils: Named[]
  drivers: Named[]
  workshops: Named[]
  /** Quienes pueden figurar como «otro mecánico» (tienen la app), sin quien registra. */
  mechanics: Named[]
}

/** `null` si el equipo ya no está activo en el módulo: sin él no hay registro posible. */
export async function loadWorkOrderRecordForm(
  viewer: MantViewer,
  ot: { vehicleId: string; worksiteId: string },
): Promise<WorkOrderRecordForm | null> {
  const [fleet, catalogs, mechanics] = await Promise.all([
    loadFleet({ scope: "all", vehicleIds: [ot.vehicleId], includeRetired: false }),
    listMantCatalogs(),
    findAppUsers(db, viewer.isGlobal && viewer.worksiteIds.length === 0 ? {} : { worksiteIds: [...new Set([...viewer.worksiteIds, ot.worksiteId])] }),
  ])
  const row = fleet[0]
  if (!row) return null
  const [schedule] = row.scheduleId ? await getCurrentScheduleSnapshots([row.scheduleId]) : []
  const brief = (entries: Named[]) => entries.map((entry) => ({ id: entry.id, name: entry.name }))
  return {
    equipment: toCatalogEquipment(row),
    schedule: schedule ?? null,
    worksiteIds: [...viewer.worksiteIds],
    workTypes: brief(catalogs.workTypes),
    oils: brief(catalogs.oils),
    drivers: brief(catalogs.drivers),
    workshops: brief(catalogs.workshops),
    mechanics: mechanics.filter((mechanic) => mechanic.id !== viewer.userId),
  }
}

export type WebRecordOutcome =
  | { ok: true; id: string; folio: string; duplicate: boolean; warnings: SyncWarning[]; workOrderId: string; vehicleId: string }
  | { ok: false; message: string; field?: string }

const fail = (message: string, field?: string): WebRecordOutcome => ({ ok: false, message, ...(field ? { field } : {}) })

function parseRecord(raw: FormDataEntryValue | null): { ok: true; record: SyncRecord } | { ok: false; outcome: WebRecordOutcome } {
  if (typeof raw !== "string") return { ok: false, outcome: fail("Faltan los datos del registro.") }
  let json: unknown
  try { json = JSON.parse(raw) } catch { return { ok: false, outcome: fail("Los datos del registro no son válidos.") } }
  const parsed = syncRecordSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, outcome: fail(issue?.message ?? "Los datos del registro no son válidos.", issue?.path.join(".") || undefined) }
  }
  return { ok: true, record: parsed.data }
}

/** El dispositivo de la foto lo pone el servidor, igual que en el registro. */
function withWebDevice(metaRaw: FormDataEntryValue | null): { raw: string | null; kind: unknown } {
  if (typeof metaRaw !== "string") return { raw: null, kind: undefined }
  try {
    const meta = JSON.parse(metaRaw) as Record<string, unknown>
    if (!meta || typeof meta !== "object") return { raw: metaRaw, kind: undefined }
    return { raw: JSON.stringify({ ...meta, deviceId: MANT_WEB_DEVICE_ID }), kind: meta.kind }
  } catch {
    // `savePhoto` responde el error de formato con su propio mensaje.
    return { raw: metaRaw, kind: undefined }
  }
}

export async function registerWorkOrderRecordFromWeb(context: SyncContext, form: FormData): Promise<WebRecordOutcome> {
  const parsed = parseRecord(form.get("record"))
  if (!parsed.ok) return parsed.outcome
  const input = parsed.record
  if (!input.workOrderId) return fail("El registro tiene que ir enlazado a la orden de trabajo.", "workOrderId")

  // El permiso se mira ANTES de guardar fotos: quien no puede registrar no deja archivos huérfanos.
  const [ot] = await db
    .select({ vehicleId: mantWorkOrders.vehicleId, status: mantWorkOrders.status, worksiteId: mantWorkOrders.worksiteId, requestedByUserId: mantWorkOrders.requestedByUserId, assignedToUserId: mantWorkOrders.assignedToUserId })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, input.workOrderId))
    .limit(1)
  if (!ot) return fail("Esa orden de trabajo no existe.", "workOrderId")
  const access = canRegisterWorkOrderRecord(context.viewer, ot)
  if (!access.ok) return fail(access.message, "workOrderId")
  if (ot.vehicleId !== input.vehicleId) return fail("El registro es de otro equipo que el de la orden de trabajo.", "vehicleId")

  const record: SyncRecord = {
    ...input,
    signedAt: new Date().toISOString(),
    offlineSince: null,
    deviceId: MANT_WEB_DEVICE_ID,
    appVersion: MANT_WEB_APP_VERSION,
  }

  for (const photo of record.photos) {
    const file = form.get(webPhotoField(photo.id))
    if (!(file instanceof File)) return fail("Falta una de las fotos. Vuelve a cargarla.", "photos")
    if (!(MANT_WEB_PHOTO_TYPES as readonly string[]).includes(file.type)) {
      return fail("Las fotos van en JPG o PNG. Si es una foto de iPhone (HEIC), guárdala como JPG y vuelve a cargarla.", "photos")
    }
    const meta = withWebDevice(form.get(webMetaField(photo.id)))
    if (meta.kind !== undefined && meta.kind !== photo.kind) return fail("Una foto se cargó con otro tipo que el declarado en el registro.", "photos")
    const saved = await savePhoto({ photoId: photo.id, file, metaRaw: meta.raw }, context)
    if (!saved.body.ok) return fail(saved.body.message, "photos")
  }

  const outcome = await createRecord(record, context)
  const body = outcome.body
  if (!body.ok) return fail(body.message, body.field)
  return { ok: true, id: body.id, folio: body.folio, duplicate: body.duplicate, warnings: body.warnings, workOrderId: input.workOrderId, vehicleId: input.vehicleId }
}
