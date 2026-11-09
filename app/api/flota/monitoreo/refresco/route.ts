import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { refreshOnwayLive } from "@/lib/integrations/onway/onway-live"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Una lectura que tiene que autenticar en Auth0 puede llegar al tope del cliente (110 s).
export const maxDuration = 120

/**
 * POST /api/flota/monitoreo/refresco
 *
 * Lo llama Monitoreo GPS cada minuto mientras está abierta; `refreshOnwayLive`
 * decide si de verdad se consulta el portal. Ruta y no Server Action: las
 * acciones se despachan de a una, y una lectura de hasta 2 minutos bloquearía
 * las demás de la página (guardar la configuración, actualizar ahora).
 */
export async function POST() {
  let session
  try {
    session = await requirePermission("flota:view")
  } catch {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 })
  }
  if (!await isRouteOperational("/flota/monitoreo")) {
    return NextResponse.json({ outcome: "disabled", reason: "module" }, { headers: { "cache-control": "no-store" } })
  }
  const result = await refreshOnwayLive({ actorUserId: session.user.id })
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } })
}
