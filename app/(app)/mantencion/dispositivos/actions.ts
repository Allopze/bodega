"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { revokeDeviceCredential } from "@/lib/services/mantencion/device-credentials"
import type { MantActionResult } from "@/lib/services/mantencion/result"

/**
 * Revocar la credencial de un dispositivo de la app del mecánico. El permiso
 * `mant:devices:manage` se pide aquí, en el servidor; el botón de la tabla sólo
 * lo refleja. El servicio audita la revocación.
 */
export async function revokeDeviceAction(input: { credentialId: string }): Promise<MantActionResult> {
  const guard = await guardPermission("mant:devices:manage", "/mantencion/equipos")
  if (guard.error) return guard.error
  const parsed = z.object({ credentialId: z.string().trim().min(1).max(64) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce el dispositivo." }
  const result = await revokeDeviceCredential({
    credentialId: parsed.data.credentialId,
    actorUserId: guard.session.user.id,
    actorEmail: guard.session.user.email ?? null,
  })
  if (result.ok) revalidatePath("/mantencion/dispositivos")
  return result
}
