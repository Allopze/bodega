/**
 * saveDraftAction — extracted from the shared request actions factory.
 */
import { revalidatePath } from "next/cache"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/masters"
import { logger } from "@/lib/logger"
import type { RequestActionsConfig } from "./request-actions.types"

export async function saveDraftActionImpl(
  config: RequestActionsConfig,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
  const { permissions, schemas, services, moduleName, itemMapper, logPrefix, routePrefix } = config
  let session
  try { session = await requirePermission(permissions.create) }
  catch { return { ok: false, message: `Sin permisos para crear solicitudes de ${moduleName === "repuestos" ? "repuestos" : "servicios"}` } }

  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { /* ignore */ }

  const parsed = schemas.request.safeParse({
    id:            formData.get("id") || undefined,
    worksiteId:    formData.get("worksiteId"),
    urgency:       formData.get("urgency") || "normal",
    requiredDate:  String(formData.get("requiredDate") ?? ""),
    justification: formData.get("justification") || "",
    items:         itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de la solicitud",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    }
  }
  const d = parsed.data
  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  try {
    const requestId = await services.persistDraft(session, {
      id:            d.id,
      worksiteId:    d.worksiteId,
      urgency:       d.urgency,
      requiredDate:  d.requiredDate,
      justification: d.justification,
      items:         d.items.map(itemMapper),
    })
    revalidatePath(routePrefix)
    return { ok: true, message: "Borrador guardado", requestId }
  } catch (e) {
    logger.error(`[${logPrefix}/saveDraftAction]`, e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar borrador" }
  }
}
