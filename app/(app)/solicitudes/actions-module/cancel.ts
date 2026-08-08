"use server"

import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests } from "@/db/schema"
import { can, canAccessWorksite, requireAuth } from "@/lib/auth/can"
import { type ActionState } from "@/lib/validation/operations"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { cancelRequest as cancelRequestTx } from "@/lib/requests/request-service-module/cancel-request"

const REVALIDATE = "/solicitudes"

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireAuth() }
  catch { return { ok: false, message: "Sin permisos" } }
  if (!can(session, "requests:create") && !can(session, "requests:view_all")) {
    return { ok: false, message: "Sin permisos para cancelar solicitudes" }
  }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  // Pre-check barato, fuera de la transacción: da un mensaje inmediato para
  // los casos obvios sin abrir una tx. La validación que importa —estado,
  // ítems ya en compra/recepción/entrega— ocurre dentro de `cancelRequestTx`
  // bajo lock, así que aunque este pre-check pase sobre datos que cambiaron
  // justo después, el servicio corta la carrera correctamente (DAT-2/DAT-6).
  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (request.requesterId !== session.user.id && !can(session, "requests:view_all")) {
    return { ok: false, message: "Solo puedes cancelar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  const reason = (formData.get("reason") as string | null)?.trim() ?? ""

  try {
    await cancelRequestTx(requestId, session.user.id, reason, {
      userEmail: session.user.email ?? undefined,
    })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al cancelar la solicitud" }
  }

  revalidateOperationalViews([REVALIDATE, `${REVALIDATE}/${requestId}`])
  redirect(REVALIDATE)
}
