import { NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { refreshOnwayLive } from "@/lib/integrations/onway/onway-live"
import type { GpsLiveResponse, GpsLiveResult } from "@/lib/integrations/onway/onway-live-contract"
import { refreshWialonLive } from "@/lib/integrations/wialon/wialon-live"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Una lectura de OnWay que tiene que autenticar en Auth0 puede llegar al tope del cliente (110 s).
export const maxDuration = 120

/**
 * Lo máximo que la respuesta espera a OnWay. Su lectura puede tardar decenas
 * de segundos (login en Auth0) y Wialon se pide cada 10 s: sin tope, un OnWay
 * lento congelaría el mapa de Wialon. Pasado el tope OnWay se informa como
 * `busy` y SIGUE corriendo en el servidor; la página lo verá en la marca de
 * captura de la próxima respuesta.
 */
export const ONWAY_RESPONSE_DEADLINE_MS = 8_000

const NO_STORE = { "cache-control": "no-store" }

/** Un proveedor que lanza no puede tumbar al otro: se informa como falla. */
async function settle(provider: string, run: Promise<GpsLiveResult>): Promise<GpsLiveResult> {
  return run.catch((error: unknown) => {
    logger.warn(`[flota/${provider}/live]`, { code: error instanceof Error ? error.name : "UNKNOWN" })
    return { outcome: "failed", code: `${provider.toUpperCase()}_LIVE_FAILED` }
  })
}

async function withDeadline(run: Promise<GpsLiveResult>, ms: number): Promise<GpsLiveResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<GpsLiveResult>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "skipped", reason: "busy" }), ms)
  })
  try {
    return await Promise.race([run, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * POST /api/flota/monitoreo/refresco
 *
 * Lo llama Monitoreo GPS cada 10 s mientras está abierta y visible; cada
 * proveedor decide si de verdad consulta (OnWay una vez por minuto y fuera de
 * la ventana de su cron; Wialon cada ~9 s, compartido entre visitantes).
 * Responde el desenlace de cada uno. Ruta y no Server Action: las acciones se
 * despachan de a una, y una lectura de hasta 2 minutos bloquearía las demás de
 * la página (guardar la configuración, actualizar ahora).
 *
 * Sin límite por usuario: son 6 pedidos por minuto y el costo real lo acotan
 * las separaciones de cada proveedor, no el número de pestañas.
 */
export async function POST() {
  let session
  try {
    session = await requirePermission("flota:view")
  } catch {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 })
  }
  if (!await isRouteOperational("/flota/monitoreo")) {
    const disabled: GpsLiveResult = { outcome: "disabled", reason: "module" }
    return NextResponse.json({ onway: disabled, wialon: disabled } satisfies GpsLiveResponse, { headers: NO_STORE })
  }

  const [onway, wialon] = await Promise.all([
    withDeadline(settle("onway", refreshOnwayLive({ actorUserId: session.user.id })), ONWAY_RESPONSE_DEADLINE_MS),
    settle("wialon", refreshWialonLive()),
  ])
  return NextResponse.json({ onway, wialon } satisfies GpsLiveResponse, { headers: NO_STORE })
}
