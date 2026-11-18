"use server"

import { revalidatePath } from "next/cache"
import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { recordAudit } from "@/lib/audit"
import { guardPermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { transferDateWindow } from "@/lib/fleet/transfer-rules"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { revalidateVehicleFicha } from "@/lib/routing/revalidate-vehicle-ficha"
import {
  isFleetStayInvariantError,
  listTransferCandidates,
  listTransfers,
  transferVehicles,
  voidTransfer,
  type TransferActor,
  type TransferCandidate,
  type TransferInput,
  type TransferOutcome,
} from "@/lib/services/fleet-transfers"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"
import type { Session } from "next-auth"

/**
 * Acciones de «Trasladar equipos». Cada una pide su permiso en el servidor, respeta el interruptor del
 * submódulo (apagado de fábrica: lo enciende un administrador), valida la forma de lo que llega y delega en
 * el servicio, que aplica las reglas de negocio y el alcance por faena. Los textos de error del servicio
 * llegan tal cual (ya redactados en español).
 */

const PATH = "/flota/traslados"
const NOT_ENABLED = "Los traslados aún no están habilitados."
const FAILED = "No se pudo completar el traslado. Inténtalo de nuevo."
const STAY_INVARIANT = "Para cambiar de faena usa «Trasladar equipos»."
const EXPORT_LIMIT = 10_000

type Failure = { ok: false; message: string }

const text = z.string().max(2000)
const transferInputSchema = z.object({
  toWorksiteId: z.string().trim().min(1).max(64),
  effectiveDate: z.string().trim().min(1).max(10),
  reason: text,
  authorizedBy: z.string().max(200),
  vehicleIds: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
})
const voidInputSchema = z.object({ transferId: z.string().trim().min(1).max(64), reason: text })
const exportFiltersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  worksiteId: z.string().trim().min(1).max(64).optional(),
})

function actorOf(session: Session): TransferActor {
  return { userId: session.user.id, email: session.user.email ?? null, scope: serviceWorksiteScope(session) }
}

/** Permiso + interruptor del submódulo. El interruptor se lee ya autorizado: no revela nada a quien no puede. */
async function authorize(permission: "flota:transfer" | "flota:export"): Promise<{ session: Session; error: null } | { session: null; error: Failure }> {
  const guard = await guardPermission(permission, PATH)
  if (guard.error) return guard
  if (!(await isRouteOperational(PATH))) return { session: null, error: { ok: false, message: NOT_ENABLED } }
  return guard
}

function failure(error: unknown, fallback: string): Failure {
  if (isFleetStayInvariantError(error)) return { ok: false, message: STAY_INVARIANT }
  const result = actionErrorResult(error, fallback)
  return { ok: false, message: result.message }
}

function revalidateAfterTransfer(vehicleIds: string[]): void {
  revalidatePath("/flota")
  revalidatePath(PATH)
  revalidatePath("/mantencion/equipos")
  for (const vehicleId of new Set(vehicleIds)) revalidateVehicleFicha(vehicleId)
}

export async function listTransferCandidatesAction(): Promise<
  | { ok: true; data: { candidates: TransferCandidate[]; worksites: Array<{ id: string; name: string }>; window: { min: string; max: string } } }
  | Failure
> {
  const guard = await authorize("flota:transfer")
  if (guard.error) return guard.error
  try {
    const scope = serviceWorksiteScope(guard.session)
    const candidates = await listTransferCandidates(scope)
    const filters = [eq(worksites.isActive, true), ...(scope === "all" ? [] : [inArray(worksites.id, scope)])]
    const sites = scope !== "all" && scope.length === 0
      ? []
      : await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(...filters)).orderBy(asc(worksites.name))
    return { ok: true, data: { candidates, worksites: sites, window: transferDateWindow(todayInChile()) } }
  } catch (error) {
    return failure(error, "No se pudieron cargar los equipos. Inténtalo de nuevo.")
  }
}

export async function transferVehiclesAction(input: TransferInput): Promise<TransferOutcome> {
  const guard = await authorize("flota:transfer")
  if (guard.error) return guard.error
  const parsed = transferInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Los datos del traslado no son válidos. Recarga la página e inténtalo de nuevo." }
  try {
    const outcome = await transferVehicles(actorOf(guard.session), parsed.data)
    if (outcome.ok) revalidateAfterTransfer(parsed.data.vehicleIds)
    return outcome
  } catch (error) {
    return failure(error, FAILED)
  }
}

export async function voidTransferAction(input: { transferId: string; reason: string }): Promise<{ ok: boolean; message: string }> {
  const guard = await authorize("flota:transfer")
  if (guard.error) return guard.error
  const parsed = voidInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Los datos de la anulación no son válidos. Recarga la página e inténtalo de nuevo." }
  try {
    const outcome = await voidTransfer(actorOf(guard.session), parsed.data)
    if (outcome.ok) {
      revalidatePath("/flota")
      revalidatePath(PATH)
      revalidatePath("/mantencion/equipos")
      // El servicio no devuelve qué equipos volvieron: se refrescan las fichas de todos (patrón + layout).
      revalidatePath("/flota/[id]", "layout")
    }
    return outcome
  } catch (error) {
    return failure(error, "No se pudo anular el traslado. Inténtalo de nuevo.")
  }
}

/** «2026-11-10» como fecha de Excel (medianoche UTC: Excel no lleva zona). */
function plainDateToExcel(date: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

export async function exportTransfersAction(filters: { from: string; to: string; worksiteId?: string }): Promise<ExportActionResult> {
  const guard = await authorize("flota:export")
  if (guard.error) return guard.error
  const parsed = exportFiltersSchema.safeParse(filters)
  if (!parsed.success) return { ok: false, message: "El rango de fechas no es válido." }
  try {
    const transfers = await listTransfers(serviceWorksiteScope(guard.session), parsed.data)
    const rows = transfers.flatMap((transfer) => transfer.items.map((item) => ({ transfer, item })))
    const truncated = rows.length > EXPORT_LIMIT
    const exportRows = rows.slice(0, EXPORT_LIMIT)

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Traslados")
    sheet.columns = [
      { header: "Folio", key: "folio", width: 12 },
      { header: "Fecha", key: "date", width: 14, style: { numFmt: "dd-mm-yyyy" } },
      { header: "Código", key: "code", width: 14 },
      { header: "Patente", key: "plate", width: 14 },
      { header: "Desde", key: "from", width: 24 },
      { header: "A", key: "to", width: 24 },
      { header: "Motivo", key: "reason", width: 44 },
      { header: "Autorizado por", key: "authorizedBy", width: 24 },
      { header: "Registrado por", key: "createdBy", width: 24 },
      { header: "Registrado el", key: "createdAt", width: 18, style: { numFmt: "dd-mm-yyyy hh:mm" } },
      { header: "Estado", key: "status", width: 12 },
      { header: "Motivo de anulación", key: "voidReason", width: 44 },
    ]
    for (const { transfer, item } of exportRows) {
      sheet.addRow({
        folio: transfer.folio,
        date: plainDateToExcel(transfer.effectiveDate),
        code: item.code ?? "",
        plate: item.plate,
        from: item.fromWorksiteName,
        to: transfer.toWorksiteName,
        reason: transfer.reason,
        authorizedBy: transfer.authorizedBy,
        createdBy: transfer.createdByName ?? "",
        createdAt: new Date(transfer.createdAt),
        status: transfer.voidedAt ? "Anulado" : "Vigente",
        voidReason: transfer.voidReason ?? "",
      })
    }
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
    await addExportMetadataSheet(workbook, guard.session, {
      filters: parsed.data,
      rowCount: exportRows.length,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    const base64 = await xlsxToBase64(workbook)
    await recordAudit({
      userId: guard.session.user.id,
      userEmail: guard.session.user.email ?? undefined,
      action: "export",
      entityType: "fleet_transfers_export",
      entityId: nanoid(),
      newState: { filters: parsed.data, rowCount: exportRows.length, truncated },
    })
    return {
      ok: true,
      data: { base64, filename: `traslados_${todayInChile()}.xlsx`, truncated, rowLimit: EXPORT_LIMIT },
    }
  } catch (error) {
    return failure(error, "No se pudo exportar. Inténtalo de nuevo.")
  }
}
