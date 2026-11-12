"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { deviceManagerActor, viewerFromSession } from "@/lib/services/mantencion/access"
import { revokeDeviceCredential } from "@/lib/services/mantencion/device-credentials"
import type { MantActionResult } from "@/lib/services/mantencion/result"

const PATH = "/mantencion/dispositivos"

/** Quien revoca y las faenas cuyos dispositivos puede desconectar. */
function deviceActor(session: Session) {
  return deviceManagerActor(viewerFromSession(session))
}

/**
 * Revocar la credencial de un dispositivo de la app del mecánico. El permiso
 * `mant:devices:manage` se pide aquí, en el servidor; el botón de la tabla sólo
 * lo refleja. El servicio audita la revocación y valida que el dispositivo sea
 * de una faena de quien revoca.
 */
export async function revokeDeviceAction(input: { credentialId: string }): Promise<MantActionResult> {
  const guard = await guardPermission("mant:devices:manage", PATH)
  if (guard.error) return guard.error
  const parsed = z.object({ credentialId: z.string().trim().min(1).max(64) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce el dispositivo." }
  const result = await revokeDeviceCredential({
    credentialId: parsed.data.credentialId,
    actorUserId: guard.session.user.id,
    actorEmail: guard.session.user.email ?? null,
    actor: deviceActor(guard.session),
  })
  if (result.ok) revalidatePath(PATH)
  return result
}
