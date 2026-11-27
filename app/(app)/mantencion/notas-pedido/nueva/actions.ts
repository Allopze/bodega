"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { SparePartOption } from "@/app/(app)/solicitudes/request-form.types"
import { toSparePartOption } from "@/app/(app)/solicitudes/spare-part-options"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardAnyPermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { MANT_PARTS_NOTE_MAX_LINES } from "@/lib/mantencion/contracts"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { createPartsNote } from "@/lib/services/mantencion/parts-notes/create-manual"
import { revalidateQueueOfNote } from "@/lib/services/mantencion/queue-revalidation"
import { SPARE_PART_SEARCH_LIMIT, searchSpareParts } from "@/lib/services/spare-parts-catalog"
import type { Permission } from "@/modules/permissions"

/**
 * Alta de una nota de pedido (NP) desde el PC (R15). Cada acción pide `mant:np:create` en el servidor (el botón y la página
 * sólo lo reflejan), valida la entrada con Zod y delega en `createPartsNote`, que comprueba faena del alcance, OT, cargo
 * y proveedor y es idempotente por `clientOpId`: reenviar el mismo borrador tras un corte devuelve la misma nota.
 *
 * Reciben un objeto (no `FormData`): el formulario envía de forma imperativa para conservar lo escrito si la red falla.
 */

const PATH = "/mantencion/notas-pedido"
const CREATE: Permission[] = ["mant:np:create"]

const id = z.string().trim().min(1).max(64)
const optionalId = id.nullish()

const lineSchema = z.object({
  description: z.string({ message: "Describe el repuesto (al menos 3 letras)." }).trim().min(3, "Describe el repuesto (al menos 3 letras).").max(300),
  quantity: z.number({ message: "Indica la cantidad." }).positive("La cantidad debe ser mayor que cero.").max(100_000),
  unitOfMeasure: z.string({ message: "Indica la unidad." }).trim().min(1, "Indica la unidad.").max(40),
  partNumber: z.string().trim().max(80).nullish(),
  productId: optionalId,
  chargeVehicleId: optionalId,
  chargeCostCenterId: optionalId,
  suggestedSupplierId: optionalId,
})

const createSchema = z.object({
  clientOpId: z.string({ message: "Identificador de operación inválido." }).trim().min(8, "Identificador de operación inválido.").max(64),
  worksiteId: z.string({ message: "Elige la faena." }).trim().min(1, "Elige la faena.").max(64),
  workOrderId: optionalId,
  urgent: z.boolean(),
  notes: z.string().trim().max(500).nullish(),
  lines: z.array(lineSchema, { message: "Agrega al menos un repuesto." }).min(1, "Agrega al menos un repuesto.").max(MANT_PARTS_NOTE_MAX_LINES),
})

export type CreatePartsNoteActionResult =
  | { ok: true; message: string; data: { noteId: string; code: string; duplicate: boolean } }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }

/** Errores de Zod por la ruta completa del campo (`lines.1.quantity`): el formulario los pinta bajo su línea. */
function invalid(error: z.ZodError): CreatePartsNoteActionResult {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message)
  return { ok: false, message: error.issues[0]?.message ?? "Revisa los datos de la nota.", fieldErrors }
}

/** «Enviar nota»: crea la NP (con o sin OT) y deja listo el detalle al que navega la pantalla. */
export async function createPartsNoteAction(input: unknown): Promise<CreatePartsNoteActionResult> {
  const guard = await guardAnyPermission(CREATE, PATH)
  if (guard.error) return guard.error
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    const result = await createPartsNote(viewerFromSession(guard.session), { ...parsed.data, notes: parsed.data.notes || undefined })
    if (!result.ok) {
      return { ok: false, message: result.message, ...(result.field ? { fieldErrors: { [result.field]: [result.message] } } : {}) }
    }
    // Una nota nueva es trabajo de la cola de la jefatura de su faena: bandeja, Panel y avisos del menú.
    revalidatePath(PATH)
    revalidatePath("/mantencion/panel")
    await revalidateQueueOfNote(result.noteId)
    return {
      ok: true,
      message: result.duplicate ? `La nota ${result.code} ya estaba creada.` : `Nota ${result.code} creada.`,
      data: { noteId: result.noteId, code: result.code, duplicate: result.duplicate },
    }
  } catch (error) {
    return actionErrorResult(error, "No se pudo crear la nota de pedido. Inténtalo de nuevo.")
  }
}

const searchSchema = z.object({ query: z.string().trim().max(100) })

export type SearchNoteSparePartsResult =
  | { ok: true; parts: SparePartOption[] }
  | { ok: false; message: string }

/**
 * Buscador de repuestos del catálogo (nombre, SKU, N° de parte o marca) del formulario. Es la misma búsqueda de «Solicitud
 * de repuestos», pero con el permiso de la nota (`mant:np:create`: el mecánico no tiene `repuestos:create`) y SIN precios
 * ni proveedores: quien pide no ve lo que se pagó.
 */
export async function searchNoteSparePartsAction(input: unknown): Promise<SearchNoteSparePartsResult> {
  const guard = await guardAnyPermission(CREATE, PATH)
  if (guard.error) return { ok: false, message: "Sin permisos para pedir repuestos." }
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Revisa la búsqueda." }
  if (!parsed.data.query) return { ok: true, parts: [] }
  try {
    const found = await searchSpareParts({ query: parsed.data.query, limit: SPARE_PART_SEARCH_LIMIT })
    const none = new Set<string>()
    return {
      ok: true,
      parts: found.parts.map((part) => ({
        ...toSparePartOption(part, { activeSupplierIds: none, visibleVehicleIds: none }),
        lastPrice: null,
        referencePrice: null,
      })),
    }
  } catch (error) {
    logger.error("[searchNoteSparePartsAction]", error)
    return { ok: false, message: "No se pudo buscar en el catálogo de repuestos." }
  }
}
