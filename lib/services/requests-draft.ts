/**
 * lib/services/requests-draft.ts
 *
 * Creación de solicitudes de compra (EPP/otro).
 *
 * Ya no existe una ruta de edición: desde la simplificación del flujo
 * (2026-08-07) estas solicitudes nacen enviadas y se corrigen aprobando,
 * rechazando o cancelando, nunca reescribiendo los ítems. Con eso desapareció
 * el persist por diff que protegía `approval_decisions` de un borrador
 * reescrito (auditoría A-01 / A-08): sin edición no hay reescritura.
 */

import { db } from "@/db"
import type { RequestFormData } from "@/lib/validation/operations"
import { createRequest } from "./requests-draft-create"
import { reserveReplenishmentGapsTx } from "./epp-replenishment"

/**
 * Crea una solicitud EPP/otro ya enviada a aprobación, en una sola transacción.
 *
 * Antes esto eran dos pasos (crear borrador + enviarlo) en transacciones
 * distintas; una caída entre medio dejaba un borrador huérfano que el flujo
 * nuevo ya no sabe editar. Aquí la solicitud o nace enviada o no nace.
 */
export async function createSubmittedRequest(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
): Promise<{ requestId: string; code: string }> {
  return await db.transaction(async (tx) => {
    const { requestId, code, itemIds } = await createRequest(
      tx, data, sessionUserId, sessionUserEmail,
    )

    const reservations = data.items.flatMap((item, i) => {
      const key = item.replenishmentGapKey?.trim()
      const requestItemId = itemIds[i]
      return key && requestItemId ? [{ gapKey: key, requestItemId }] : []
    })
    if (reservations.length > 0) await reserveReplenishmentGapsTx(tx, reservations)

    return { requestId, code }
  })
}

