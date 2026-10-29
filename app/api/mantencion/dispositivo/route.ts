export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { deviceCredentialRequestSchema, type DeviceCredentialResponse } from "@/lib/mantencion/contracts"
import { issueDeviceCredential } from "@/lib/services/mantencion/device-credentials"
import { issueResponse, NO_STORE, readJsonBody } from "@/lib/services/mantencion/sync-http"
import { logger } from "@/lib/logger"

/**
 * POST /api/mantencion/dispositivo — emite la credencial de dispositivo de la
 * app del mecánico. NO es pública: el proxy ya exige sesión y mismo origen, y
 * aquí se vuelve a exigir el permiso. La credencial se entrega UNA vez; en la
 * base sólo queda su huella. Emitir otra para el mismo (cuenta, dispositivo)
 * revoca la anterior.
 */
export async function POST(request: Request) {
  const guard = await guardPermission("mant:app:use")
  if (guard.error || !guard.session) return NextResponse.json(guard.error ?? { ok: false, message: "No tienes permisos para realizar esta acción" }, { status: 403, headers: NO_STORE })

  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = deviceCredentialRequestSchema.safeParse(body.body)
  if (!parsed.success) return issueResponse(parsed.error)

  const user = guard.session.user
  try {
    const credential = await issueDeviceCredential({
      userId: user.id,
      deviceId: parsed.data.deviceId,
      label: parsed.data.label ?? null,
      actorEmail: user.email ?? null,
    })
    const response: DeviceCredentialResponse = {
      token: credential.token,
      expiresAt: credential.expiresAt,
      user: { id: user.id, name: user.name ?? "", email: user.email ?? "" },
    }
    return NextResponse.json(response, { headers: NO_STORE })
  } catch (error) {
    logger.error("[mantencion:dispositivo]", error)
    return NextResponse.json(
      { ok: false, code: "error", message: "No se pudo emitir la credencial del dispositivo. Reintenta." },
      { status: 500, headers: NO_STORE },
    )
  }
}
