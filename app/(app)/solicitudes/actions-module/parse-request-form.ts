import type { Session } from "next-auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { requestSchema, type ActionState, type RequestFormData } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { isRequestType, permissionForRequestType } from "@/lib/request-types"

/**
 * Valida el formulario de solicitud (permiso por tipo, esquema y acceso a la
 * faena). Lo comparten el creador de solicitudes enviadas (EPP/otro) y el
 * borrador de los tipos con cotización, para que ambos rechacen lo mismo.
 */
export function parseRequestForm(
  session: Session,
  formData: FormData,
): { ok: true; data: RequestFormData } | { ok: false; error: ActionState } {
  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { logger.warn("[parseRequestForm] itemsJson inválido en formData, se usará arreglo vacío") }

  const requestTypeRaw = formData.get("requestType") || "epp"
  if (isRequestType(requestTypeRaw) && !can(session, permissionForRequestType(requestTypeRaw, "create"))) {
    return { ok: false, error: { ok: false, message: "No tienes permisos para crear este tipo de solicitud" } }
  }

  const parsed = requestSchema.safeParse({
    id:           formData.get("id") || undefined,
    worksiteId:   formData.get("worksiteId"),
    requestType:  requestTypeRaw,
    urgency:      formData.get("urgency") || "normal",
    // El formulario lo manda desde siempre, pero no se leía acá: el esquema
    // lo defaulteaba y TODA solicitud nacía 'via_oficina', ignorando el
    // despacho que el solicitante había elegido.
    deliveryMode: formData.get("deliveryMode") || "via_oficina",
    requiredDate: String(formData.get("requiredDate") ?? ""),
    notes:        formData.get("notes") || "",
    items:        itemsRaw,
  })
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    const fieldErrors = flattened.fieldErrors as Record<string, string[]>
    return {
      ok: false,
      error: {
        ok: false,
        message: fieldErrors.items?.[0]
          ? `Revisa los ítems de la solicitud: ${fieldErrors.items[0]}`
          : "Revisa los datos de la solicitud",
        fieldErrors,
      },
    }
  }

  if (!canAccessWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, error: { ok: false, message: "No tienes acceso a la faena seleccionada" } }
  }

  return { ok: true, data: parsed.data }
}
