"use server"

/**
 * Acciones de la revisión de Copec en «Fuentes de datos».
 *
 * Son las dos decisiones humanas que faltaban (auditoría 2026-11-05, C1 y C2):
 * cerrar un mes con observaciones —con motivo y evidencia, estado terminal
 * `closed_with_issues` de la decisión E6— y resolver o descartar una corrección
 * del proveedor. Sin ellas el mes quedaba `incomplete` para siempre y el barrido
 * no avanzaba (4.1 y 4.2).
 *
 * Viven en la pantalla de Fuentes y no en `importar/` porque es ahí donde el
 * operador ve el problema; el servicio que decide está en `copec-sync.ts` /
 * `fuel-provider-ledger.ts`, que es lo que las pruebas ejercitan contra la base.
 */

import { z } from "zod"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import { civilDate } from "@/lib/validation/dates"
import { reasonSchema } from "@/lib/validation/reason-thresholds"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"
import { closeCopecPeriodWithIssuesFor } from "@/lib/combustibles/copec-sync"
import { resolveFuelProviderRejection } from "@/lib/combustibles/fuel-provider-ledger"

const closePeriodSchema = z.object({
  month: civilDate(),
  channel: z.enum(["TCT", "TAE"]),
  product: z.enum(["diesel", "bluemax"]),
  reason: reasonSchema("la evidencia revisada para cerrar el mes con observaciones"),
})

const resolveRejectionSchema = z.object({
  rejectionId: z.string().trim().min(1),
  decision: z.enum(["resolved", "dismissed"]),
  reason: reasonSchema("por qué se aprueba o se descarta la observación del proveedor"),
})

export type CopecReviewActionResult =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Cierra un canal/producto/mes como `closed_with_issues`.
 *
 * Sólo si el mes ya terminó y no quedan filas sin asignar: el servicio vuelve a
 * comprobarlo sobre la fila guardada, así que una corrida que cambió la
 * cobertura entre la pantalla y el envío no deja un cierre inválido.
 */
export async function resolveCopecPeriodWithIssuesAction(input: {
  month: string
  channel: "TCT" | "TAE"
  product: "diesel" | "bluemax"
  reason: string
}): Promise<CopecReviewActionResult> {
  const guard = await guardPermission("combustibles:sync_integrations", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  try {
    const parsed = closePeriodSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El cierre del mes no es válido" }
    await closeCopecPeriodWithIssuesFor({
      ...parsed.data,
      actorUserId: guard.session.user.id,
      actorEmail: guard.session.user.email ?? null,
    })
    revalidateFuel()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible cerrar el mes con observaciones") }
  }
}

/**
 * Resuelve (`resolved`) o descarta (`dismissed`) una observación del proveedor.
 * La próxima sincronización del mes aplica la decisión: la corrección aprobada
 * reemplaza la carga anterior y la descartada se ignora.
 */
export async function resolveCopecRejectionAction(input: {
  rejectionId: string
  decision: "resolved" | "dismissed"
  reason: string
}): Promise<CopecReviewActionResult> {
  const guard = await guardPermission("combustibles:sync_integrations", FUEL_PATHS.fuentes)
  if (guard.error) return guard.error
  try {
    const parsed = resolveRejectionSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "La decisión no es válida" }
    await resolveFuelProviderRejection({
      rejectionId: parsed.data.rejectionId,
      status: parsed.data.decision,
      reason: parsed.data.reason,
      actorUserId: guard.session.user.id,
      actorEmail: guard.session.user.email ?? null,
    })
    revalidateFuel()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible resolver la observación") }
  }
}
