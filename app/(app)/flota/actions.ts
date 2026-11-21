"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { promises as fs } from "node:fs"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { can, guardPermission, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, serviceWorksiteScope } from "@/lib/auth/scope"
import { VEHICLE_EXPIRY_FIELDS, formatFuelVehicleStatus, updateVehicleExpiriesSchema, type VehicleExpiryField } from "@/lib/combustibles/validation"
import { meterSourceLabel } from "@/lib/combustibles/meter-source"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { uploadFleetDocument, deleteFleetDocument, getFleetOverview, getFleetProviderGapMonths, FLEET_OVERVIEW_LOOKBACK_MONTHS } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { createFleetDocumentPath, resolveFleetDir, resolveStorageFile } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import type { ActionState } from "@/lib/validation/operations"
import { fleetDocumentMetadataSchema } from "@/lib/validation/fleet-documents"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { filterFleetOverviewRows, type FleetOverviewFilters } from "@/lib/fleet-overview-filters"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"
import { fleetProviderGapNotice } from "./fleet-provider-gap"
import { formatLastReading } from "./fleet-last-reading"
import { revalidateVehicleFicha } from "@/lib/routing/revalidate-vehicle-ficha"
import { assignVehiclesToContract, endVehicleAssignment } from "@/lib/services/contracts/assignments"
import { civilDate } from "@/lib/validation/dates"
import { z } from "zod"
import { createFleetOwnerTx, isFleetOwnerKind, setVehicleOwnershipTx } from "@/lib/services/fleet-owners"
import {
  createPersonalUsePeriod,
  deletePersonalUsePeriod,
  getPersonalUsePeriodVehicleId,
  updatePersonalUsePeriod,
} from "@/lib/services/fleet-personal-use"

const FLEET_EXPORT_LIMIT = 10_000

export async function uploadFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para subir documentos" } }

  // Tipo y vencimiento entraban crudos: cualquier string se guardaba como tipo
  // documental y una fecha inexistente quedaba en la columna que alimenta las
  // alertas de vencimiento.
  // `formData.get` devuelve `null` cuando el campo no viaja; se normaliza a ""
  // para que el mensaje sea el del esquema y no el genérico de Zod en inglés.
  const parsed = fleetDocumentMetadataSchema.safeParse({
    vehicleId: (formData.get("vehicleId") as string) ?? "",
    documentType: (formData.get("documentType") as string) ?? "",
    expiresAt: (formData.get("expiresAt") as string) || null,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos del documento" }
  }
  const { vehicleId, documentType, expiresAt } = parsed.data
  const file = formData.get("file") as File | null

  if (!file || file.size === 0) return { ok: false, message: "Archivo requerido" }

  const MAX_MB = 20
  if (file.size > MAX_MB * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el límite de ${MAX_MB} MB` }
  }

  const fileBuf = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, file.size, MimeType.PROOF)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const safeName = (file.name || "documento")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "documento"
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFleetDir()
  const relativePath = createFleetDocumentPath(storageName)
  const absolutePath = resolveStorageFile(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(fileBuf))

  try {
    const docId = await uploadFleetDocument({
      vehicleId,
      documentType,
      fileName: safeName,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validation.mimeType,
      expiresAt: expiresAt || null,
    }, session, serviceWorksiteScope(session))

    revalidatePath("/flota")
    revalidateVehicleFicha(vehicleId)
    return { ok: true, message: "Documento subido", data: { id: docId } }
  } catch (e) {
    await fs.unlink(absolutePath).catch(() => undefined)
    logger.error("[uploadFleetDocumentAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al subir documento") }
  }
}

export async function deleteFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para eliminar documentos" } }

  const documentId = formData.get("documentId") as string
  const vehicleId = formData.get("vehicleId") as string
  const reason = String(formData.get("reason") ?? "")
  if (!documentId) return { ok: false, message: "Documento requerido" }

  try {
    // FLO-003: se anula con motivo, no se borra. El archivo se conserva.
    await deleteFleetDocument(documentId, session, serviceWorksiteScope(session), reason)
    revalidatePath("/flota")
    if (vehicleId) revalidateVehicleFicha(vehicleId)
    return { ok: true, message: "Documento anulado" }
  } catch (e) {
    logger.error("[deleteFleetDocumentAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al eliminar documento") }
  }
}

/**
 * «Cambiar contrato» de la ficha del equipo: lo asigna a un contrato de su faena desde un día
 * (`contractId`), o lo deja «Sin contrato» (`contractId` vacío: la asignación que rige termina el
 * día anterior a `validFrom`). Las vigencias, los traslapes y que el contrato sea de la faena del
 * equipo los sostiene el servicio; aquí van el permiso y el alcance de la faena del equipo.
 */
export async function changeVehicleContractAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission("mant:equipment:manage")
  if (error) return error

  const vehicleId = String(formData.get("vehicleId") ?? "").trim()
  const contractId = String(formData.get("contractId") ?? "").trim()
  if (!vehicleId) return { ok: false, message: "Elige un equipo" }
  const from = civilDate("Indica desde qué día").safeParse(String(formData.get("validFrom") ?? "").trim())
  if (!from.success) {
    return { ok: false, message: from.error.issues[0]?.message ?? "Indica desde qué día", fieldErrors: { validFrom: [from.error.issues[0]?.message ?? "Indica desde qué día"] } }
  }
  const validFrom = from.data

  try {
    const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
    if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }
    if (!canAccessWorksite(session, vehicle.worksiteId)) {
      return { ok: false, message: "No puedes gestionar vehículos de esta faena" }
    }

    const actor = { userId: session.user.id, email: session.user.email }
    if (contractId) {
      const result = await assignVehiclesToContract(actor, { contractId, vehicleIds: [vehicleId], validFrom })
      if (!result.ok) return { ok: false, message: result.message }
      revalidateAfterContractChange(vehicleId, vehicle.worksiteId)
      return { ok: true, message: ["Contrato actualizado", ...result.warnings].join(". ") }
    }
    const result = await endVehicleAssignment(actor, { vehicleId, lastDay: addDaysToPlainDate(validFrom, -1) })
    if (!result.ok) return { ok: false, message: result.message }
    revalidateAfterContractChange(vehicleId, vehicle.worksiteId)
    return { ok: true, message: "Equipo sin contrato" }
  } catch (e) {
    logger.error("[changeVehicleContractAction]", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo cambiar el contrato") }
  }
}

function revalidateAfterContractChange(vehicleId: string, worksiteId: string): void {
  revalidatePath("/flota")
  revalidatePath(`/admin/faenas/${worksiteId}`)
  revalidateVehicleFicha(vehicleId)
  revalidatePath("/control-operacional")
}

/**
 * «Uso personal» de la ficha del equipo: marcar, corregir o quitar un período en que el dueño se
 * llevó el equipo. En esos días el equipo no suma plata, litros ni km en los reportes de gestión.
 * Las fechas, los solapes y la auditoría los sostiene el servicio; aquí van el permiso, el alcance
 * de la faena del equipo (al editar, el del equipo del período, no el que diga el formulario) y
 * refrescar las pantallas que cambian.
 */
const OUT_OF_SCOPE = "No puedes gestionar vehículos de esta faena"

async function personalUseVehicleInScope(
  session: Parameters<typeof canAccessWorksite>[0],
  vehicleId: string,
): Promise<{ ok: true; worksiteId: string } | { ok: false; message: string }> {
  const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
  if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }
  if (!canAccessWorksite(session, vehicle.worksiteId)) return { ok: false, message: OUT_OF_SCOPE }
  return { ok: true, worksiteId: vehicle.worksiteId }
}

function revalidateAfterPersonalUse(vehicleId: string): void {
  revalidatePath("/flota")
  revalidateVehicleFicha(vehicleId)
  revalidatePath("/control-operacional")
  revalidatePath("/combustibles")
  revalidatePath("/dashboard")
  revalidatePath("/analitica")
}

export async function savePersonalUsePeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardPermission("flota:personal_use")
  if (error) return error

  const id = String(formData.get("id") ?? "").trim()
  const startedOnRaw = String(formData.get("startedOn") ?? "").trim()
  const endedOnRaw = String(formData.get("endedOn") ?? "").trim()
  const noteRaw = String(formData.get("note") ?? "").trim().slice(0, 500)
  const started = civilDate("Indica desde qué día").safeParse(startedOnRaw)
  if (!started.success) {
    const message = started.error.issues[0]?.message ?? "Indica desde qué día"
    return { ok: false, message, fieldErrors: { startedOn: [message] } }
  }
  const ended = endedOnRaw === "" ? null : civilDate("Indica hasta qué día, o déjalo vacío").safeParse(endedOnRaw)
  if (ended && !ended.success) {
    const message = ended.error.issues[0]?.message ?? "Indica hasta qué día, o déjalo vacío"
    return { ok: false, message, fieldErrors: { endedOn: [message] } }
  }
  const input = { startedOn: started.data, endedOn: ended ? ended.data : null, note: noteRaw === "" ? null : noteRaw }

  try {
    const vehicleId = id ? await getPersonalUsePeriodVehicleId(id) : String(formData.get("vehicleId") ?? "").trim()
    if (!vehicleId) return { ok: false, message: id ? "El período ya no existe: recarga la ficha." : "Elige un equipo" }
    const scope = await personalUseVehicleInScope(session, vehicleId)
    if (!scope.ok) return scope

    const actor = { userId: session.user.id, email: session.user.email ?? null }
    const result = id
      ? await updatePersonalUsePeriod(actor, id, input)
      : await createPersonalUsePeriod(actor, { vehicleId, ...input })
    if (!result.ok) return { ok: false, message: result.message }
    revalidateAfterPersonalUse(vehicleId)
    return { ok: true, message: id ? "Uso personal actualizado" : "Uso personal marcado" }
  } catch (e) {
    logger.error("[savePersonalUsePeriodAction]", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar el uso personal") }
  }
}

export async function deletePersonalUsePeriodAction(id: string): Promise<ActionState> {
  const { session, error } = await guardPermission("flota:personal_use")
  if (error) return error

  try {
    const vehicleId = await getPersonalUsePeriodVehicleId(String(id ?? "").trim())
    if (!vehicleId) return { ok: false, message: "El período ya no existe: recarga la ficha." }
    const scope = await personalUseVehicleInScope(session, vehicleId)
    if (!scope.ok) return scope

    const result = await deletePersonalUsePeriod({ userId: session.user.id, email: session.user.email ?? null }, id)
    if (!result.ok) return { ok: false, message: result.message }
    revalidateAfterPersonalUse(vehicleId)
    return { ok: true, message: "Uso personal quitado" }
  } catch (e) {
    logger.error("[deletePersonalUsePeriodAction]", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo quitar el uso personal") }
  }
}

/**
 * «Actualizar vencimientos» de la ficha del equipo: SOAP, permiso de
 * circulación, revisión técnica y seguro, de una sola vez.
 *
 * Cada fecha tiene tres estados: ausente (no se toca), vacía (se quita: queda
 * `null`) o con fecha civil (se guarda). Lo que no cambia no se escribe ni se
 * audita. El permiso es el de los documentos de flota —quien renueva un SOAP
 * es quien sube su comprobante— y el alcance es el de faena del equipo, igual
 * que la edición del padrón.
 */
export async function updateVehicleExpiriesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para actualizar vencimientos" } }

  const raw: Record<string, string | undefined> = { vehicleId: String(formData.get("vehicleId") ?? "") }
  for (const field of VEHICLE_EXPIRY_FIELDS) raw[field] = formData.has(field) ? String(formData.get(field)) : undefined
  const parsed = updateVehicleExpiriesSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Revisa las fechas",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { vehicleId, ...incoming } = parsed.data

  try {
    const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId) })
    if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }
    if (!canAccessWorksite(session, vehicle.worksiteId)) {
      return { ok: false, message: "No puedes gestionar vehículos de esta faena" }
    }

    const changed = VEHICLE_EXPIRY_FIELDS.filter((field) => incoming[field] !== undefined && incoming[field] !== vehicle[field])
    if (changed.length === 0) return { ok: true, message: "No hay cambios en los vencimientos" }

    // Las cuatro columnas, antes y después: la bitácora dice qué fecha había y cuál quedó, también la que no cambió.
    const patch: Partial<Record<VehicleExpiryField, string | null>> = {}
    const oldState: Partial<Record<VehicleExpiryField, string | null>> = {}
    const newState: Partial<Record<VehicleExpiryField, string | null>> = {}
    for (const field of VEHICLE_EXPIRY_FIELDS) {
      oldState[field] = vehicle[field] ?? null
      const next = changed.includes(field) ? (incoming[field] ?? null) : (vehicle[field] ?? null)
      newState[field] = next
      if (changed.includes(field)) patch[field] = next
    }
    await db.transaction(async (tx) => {
      await tx.update(fuelVehicles)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(fuelVehicles.id, vehicleId))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_vehicle",
        entityId: vehicleId,
        entityCode: vehicle.code ?? vehicle.plate,
        oldState,
        newState,
        worksiteId: vehicle.worksiteId,
      }, tx)
    })

    revalidatePath("/flota")
    revalidateVehicleFicha(vehicleId)
    return { ok: true, message: changed.length === 1 ? "Vencimiento actualizado" : "Vencimientos actualizados" }
  } catch (e) {
    logger.error("[updateVehicleExpiriesAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al actualizar los vencimientos") }
  }
}

export async function exportFleetXlsxAction(filters: FleetOverviewFilters = {}) {
  let session
  try { session = await requirePermission("flota:export", "/flota") }
  catch { return { ok: false as const, message: "Sin permisos para exportar la flota" } }

  const [rows, settings, providerGapMonths] = await Promise.all([
    getFleetOverview(session, undefined, undefined, { workOrders: true }),
    getFleetAdminSettings(),
    getFleetProviderGapMonths(session),
  ])
  const today = todayInChile()
  const filtered = filterFleetOverviewRows(rows, filters, {
    today,
    warningWindowEnd: addDaysToPlainDate(today, settings.warningDays),
  })
  const truncated = filtered.length > FLEET_EXPORT_LIMIT
  const exportRows = filtered.slice(0, FLEET_EXPORT_LIMIT)
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewFuel = can(session, "combustibles:view")
  // La columna de OT sólo existe con la capacidad (la fila trae `null` si no).
  const canViewWorkOrders = exportRows.some((row) => row.openWorkOrders != null)
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Flota")
  sheet.columns = [
    { header: "Patente", key: "plate", width: 16 },
    { header: "Tipo", key: "type", width: 22 },
    { header: "Marca", key: "brand", width: 18 },
    { header: "Modelo", key: "model", width: 18 },
    { header: "Año", key: "year", width: 10 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Responsable", key: "responsible", width: 24 },
    { header: "Propietario", key: "owner", width: 26 },
    { header: "Ubicación por confirmar", key: "locationPending", width: 22 },
    { header: "Próximo vencimiento", key: "expiry", width: 42 },
    ...(canViewFuel ? [
      { header: "Litros (12 meses)", key: "liters", width: 18 },
      { header: "Cargas (12 meses)", key: "loads", width: 18 },
      // P-9: la misma lectura que la columna «Lectura (km u h)» de la lista (odómetro y, a falta de él, horómetro),
      // con la fecha en que se tomó y, si el detector tiene un caso abierto sobre ella, la misma marca.
      { header: "Última lectura", key: "lastReading", width: 44 },
      { header: "Fuente de la lectura", key: "meterSource", width: 22 },
      // Misma marca que el aviso de la columna «Lectura (km u h)» de la lista: hay un caso del detector aún abierto
      // sobre la última lectura del equipo.
      { header: "Lectura objetada", key: "objectedReading", width: 18 },
    ] : []),
    ...(canViewWorkOrders ? [{ header: "OT abiertas", key: "openWorkOrders", width: 14 }] : []),
    ...(canViewCosts && canViewFuel ? [
      { header: "Costo combustible", key: "fuelCost", width: 18 },
      { header: "Costo por km u hora", key: "fuelCostPerUnit", width: 20 },
    ] : []),
  ]
  for (const row of exportRows) {
    sheet.addRow({
      plate: row.plate,
      type: row.type,
      brand: row.brand ?? "",
      model: row.model ?? "",
      year: row.year ?? "",
      worksite: row.worksiteName,
      // Etiqueta humana, como la tabla: el enum crudo (`mantencion`) no se
      // lee igual que «En mantención» y contradice el filtro aplicado.
      status: row.isActive ? formatFuelVehicleStatus(row.operationalStatus) : "Inactivo",
      responsible: row.responsibleName ?? "",
      owner: row.ownerName ?? "",
      locationPending: row.locationPendingConfirmation ? "Sí" : "",
      // La tabla muestra tipo y fecha; el Excel exportaba sólo la fecha y
      // dejaba sin explicar de qué documento vencía.
      expiry: row.nextExpiryDate
        ? `${row.nextExpiryDocumentType ?? "Documento"}: ${row.nextExpiryDate}`
        : "",
      liters: row.totalLiters,
      loads: row.loadCount,
      lastReading: formatLastReading(row),
      meterSource: meterSourceLabel(row.meterSource) ?? "",
      // Vacía sin lectura: ahí no hay nada que objetar, y «No» afirmaría que la lectura está bien.
      objectedReading: row.lastOdometerReading == null && row.lastHourMeterReading == null ? "" : row.lastReadingObjection ? "Sí" : "No",
      openWorkOrders: row.openWorkOrders,
      fuelCost: row.totalFuelAmount,
      fuelCostPerUnit: row.fuelCostPerUnit == null || row.fuelCostPerUnitLabel == null
        ? ""
        : `${row.fuelCostPerUnit.toLocaleString("es-CL", { maximumFractionDigits: 1 })} ${row.fuelCostPerUnitLabel}`,
    })
  }
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
  // La columna de costo sólo existe con `combustibles:view_costs`: `getColumn("fuelCost")` sobre una hoja
  // sin ella no devuelve nada, lanza («Out of bounds»), y la exportación entera fallaba para quien no
  // ve costos.
  const fuelCostColumn = sheet.columns.find((column) => column.key === "fuelCost")
  if (fuelCostColumn) fuelCostColumn.numFmt = "$#,##0"
  // Las cifras de combustible (12 meses) no incluyen los meses sin datos del proveedor: la hoja
  // «Metadatos» es lo que viaja con el archivo, así que la advertencia va ahí (C-4).
  const providerGapNotice = fleetProviderGapNotice(providerGapMonths, FLEET_OVERVIEW_LOOKBACK_MONTHS)
  await addExportMetadataSheet(workbook, session, { filters, rowCount: exportRows.length, notes: providerGapNotice ? [providerGapNotice] : [] })
  const base64 = await xlsxToBase64(workbook)
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "fleet_export",
    entityId: nanoid(),
    newState: { filters, rowCount: exportRows.length, truncated, includesCosts: canViewCosts },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: `flota_${today}.xlsx`,
      truncated,
      rowLimit: FLEET_EXPORT_LIMIT,
    },
  }
}

const vehicleOwnershipSchema = z.object({
  vehicleId: z.string().trim().min(1).max(64),
  /** Id de una empresa del catálogo; vacío = sin informar. Se ignora si viene `newOwner`. */
  ownerId: z.string().trim().max(64).nullable().optional(),
  /** Empresa nueva, creada en la misma transacción (o la existente con ese nombre). */
  newOwner: z.object({ name: z.string().trim().max(200), kind: z.string().trim().max(40) }).nullable().optional(),
  locationPendingConfirmation: z.boolean(),
})
export type VehicleOwnershipInput = z.input<typeof vehicleOwnershipSchema>

/**
 * Empresa propietaria y marca «Ubicación por confirmar» de un equipo (Trinorma). Pide lo mismo que
 * editar el vehículo (`admin:fleet_vehicles` y la faena del equipo dentro del alcance). No escribe la
 * faena: sólo cambia por «Trasladar equipos». Crear la empresa en línea es parte del mismo guardado.
 */
export async function saveVehicleOwnershipAction(input: VehicleOwnershipInput): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles", "/flota") }
  catch { return { ok: false, message: "No tienes permiso para editar vehículos." } }
  const parsed = vehicleOwnershipSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa los datos del propietario." }
  const { vehicleId, ownerId, newOwner, locationPendingConfirmation } = parsed.data
  if (newOwner && !isFleetOwnerKind(newOwner.kind)) {
    return { ok: false, message: "Elige el tipo de la empresa nueva.", fieldErrors: { newOwnerKind: ["Elige el tipo de empresa"] } }
  }

  try {
    const vehicle = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, vehicleId), columns: { id: true, worksiteId: true } })
    if (!vehicle) return { ok: false, message: "Vehículo no encontrado" }
    if (!canAccessWorksite(session, vehicle.worksiteId)) return { ok: false, message: "No puedes gestionar vehículos de esta faena" }

    const actor = { userId: session.user.id, email: session.user.email }
    const result = await db.transaction(async (tx) => {
      let nextOwnerId: string | null = ownerId || null
      if (newOwner) {
        const created = await createFleetOwnerTx(tx, actor, newOwner)
        if (!created.ok) return { ok: false as const, message: created.message, fieldErrors: { newOwnerName: [created.message] } }
        nextOwnerId = created.data.id
      }
      return setVehicleOwnershipTx(tx, actor, { vehicleId, ownerId: nextOwnerId, locationPendingConfirmation })
    })
    if (!result.ok) return result
    revalidatePath("/flota")
    revalidateVehicleFicha(vehicleId)
    return { ok: true, message: result.message }
  } catch (e) {
    logger.error("[saveVehicleOwnershipAction]", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar el propietario") }
  }
}
