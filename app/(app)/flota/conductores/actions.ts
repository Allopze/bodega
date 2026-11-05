"use server"

import { revalidatePath } from "next/cache"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { EXCEL_DATE_FORMAT, excelPlainDate } from "@/lib/reports/excel-dates"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import type { ReportData } from "@/lib/reports/export-module/types"
import { listDriverRoster, removeDriverLicense, upsertDriverLicense } from "@/lib/services/driver-licenses"
import { DRIVER_STATUS_LABEL, driverLicenseSchema } from "@/lib/validation/driver-licenses"
import type { ActionState } from "@/lib/validation/masters"
import {
  DRIVER_ESTADO_LABEL,
  classesLabel,
  displayPosition,
  filterDriversByEstado,
  parseDriverEstado,
  requiredClassesLabel,
  type DriverExportFilters,
} from "./drivers-view"

/**
 * La pantalla `/flota/conductores` es la única que usa estas acciones. El permiso
 * (`flota:manage_licenses`) y el alcance de faena los vuelve a comprobar el
 * servicio (`lib/services/driver-licenses.ts`): que la acción lo pida no es lo
 * único que protege la licencia.
 */
const PAGE = "/flota/conductores"

/** El servicio entrega un mensaje por campo; `Field` y `ActionState` esperan una lista. */
function toFieldErrors(errors: Partial<Record<string, string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [field, message] of Object.entries(errors)) {
    if (message) result[field] = [message]
  }
  return result
}

export async function saveDriverLicenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("flota:manage_licenses", PAGE)
  if (guard.error) return guard.error
  const { session } = guard

  const parsed = parseZ(driverLicenseSchema, {
    workerId: String(formData.get("workerId") ?? ""),
    classes: formData.getAll("classes").map(String),
    // Una fecha vacía es «sin fecha registrada», no una fecha inválida.
    expiresAt: String(formData.get("expiresAt") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  }, "Revisa los datos de la licencia")
  if (!parsed.ok) return parsed

  try {
    const result = await upsertDriverLicense(session, parsed.data)
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        ...(result.fieldErrors ? { fieldErrors: toFieldErrors(result.fieldErrors) } : {}),
      }
    }
    // Basta con revalidar: la respuesta de la acción ya trae la página nueva. Un
    // `router.refresh()` además del `revalidatePath` pedía la página dos veces.
    revalidatePath(PAGE)
    return {
      ok: true,
      message: `Licencia de ${result.row.name} guardada`,
      data: { workerId: result.row.workerId, status: result.row.status },
    }
  } catch (error) {
    logger.error("[flota:saveDriverLicense]", error)
    return actionErrorResult(error, "No se pudo guardar la licencia. Inténtalo de nuevo.")
  }
}

export async function removeDriverLicenseAction(workerId: string): Promise<ActionState> {
  const guard = await guardPermission("flota:manage_licenses", PAGE)
  if (guard.error) return guard.error
  if (typeof workerId !== "string" || workerId.trim() === "") return { ok: false, message: "Trabajador requerido" }

  try {
    const result = await removeDriverLicense(guard.session, workerId)
    if (!result.ok) return { ok: false, message: result.message }
    revalidatePath(PAGE)
    return { ok: true, message: "Licencia quitada" }
  } catch (error) {
    logger.error("[flota:removeDriverLicense]", error)
    return actionErrorResult(error, "No se pudo quitar la licencia. Inténtalo de nuevo.")
  }
}

const EXPORT_HEADERS = [
  "Trabajador",
  "RUT",
  "Faena",
  "Cargo",
  "Clases",
  "Válida hasta",
  "Estado",
  "Observación",
  "Clases exigidas",
]
/** Índice (desde 0) de «Válida hasta»: la única columna de fecha. */
const EXPIRES_COLUMN = 5

export async function exportDriversXlsxAction(filters: DriverExportFilters) {
  const guard = await guardPermission("flota:manage_licenses", PAGE)
  if (guard.error) return { ok: false as const, message: "Sin permisos para exportar las licencias" }
  const { session } = guard

  // El navegador manda lo que quiere; lo que no se reconoce cae en la vista completa.
  const estado = parseDriverEstado(filters?.estado) ?? "todos"
  const faena = typeof filters?.faena === "string" && filters.faena.trim() !== "" ? filters.faena.trim() : null

  try {
    const roster = await listDriverRoster(session, faena ? { worksiteId: faena } : undefined)
    const rows = filterDriversByEstado(roster.rows, estado)
    const faenaName = faena ? roster.worksites.find((worksite) => worksite.id === faena)?.name ?? null : null

    const report: ReportData = {
      filenameBase: "conductores",
      worksheetName: "Conductores",
      headers: EXPORT_HEADERS,
      rows: rows.map((row) => [
        row.name,
        row.rut ?? "",
        row.worksiteName,
        displayPosition(row.positionName),
        classesLabel(row.license?.classes ?? []),
        // Fecha real de Excel (ordenable y filtrable), no texto.
        excelPlainDate(row.license?.expiresAt),
        DRIVER_STATUS_LABEL[row.status],
        row.license?.notes ?? "",
        requiredClassesLabel(row),
      ]),
      columnFormats: { [EXPIRES_COLUMN]: EXCEL_DATE_FORMAT },
    }
    const buffer = await buildXlsxBuffer(report, {
      session,
      filters: { vista: DRIVER_ESTADO_LABEL[estado], faena: faenaName ?? "Todas las faenas del alcance" },
    })
    const base64 = Buffer.from(buffer).toString("base64")

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "driver_license_export",
      entityId: nanoid(),
      newState: { estado, faena, rowCount: rows.length },
      worksiteId: faena,
    })

    return {
      ok: true as const,
      data: { base64, filename: `conductores_${roster.today}.xlsx` },
    }
  } catch (error) {
    logger.error("[flota:exportDrivers]", error)
    return { ok: false as const, message: "No se pudo generar el Excel. Inténtalo de nuevo." }
  }
}
