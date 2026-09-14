/**
 * Health check endpoint.
 *
 * Verifies:
 * - PostgreSQL connectivity (SELECT 1)
 * - Storage volume is writable (creates and removes a temp file)
 * - Disk space (warns if < 10% free or < 1 GB free)
 *
 * Docker HEALTHCHECK uses this. Deploy workflow validates post-deploy.
 *
 * La medición vive en `lib/services/platform-health.ts` porque `/admin/modulos`
 * necesita la misma señal: una pantalla no puede afirmar salud llamándose a sí
 * misma por HTTP.
 *
 * HALLAZGO SEC-001 (S3/P2) — Antes esta ruta, que el proxy declara pública,
 * devolvía el detalle completo a cualquiera: estado de la base, del volumen,
 * porcentaje de disco libre y **bytes libres absolutos**. Un tercero que
 * alcanzara el host obtenía señal de capacidad de la infraestructura sin
 * credenciales. Ahora el cuerpo público es un veredicto binario —al
 * `HEALTHCHECK` de Docker y a `curl -sf` del despliegue les basta el código
 * HTTP— y el detalle sólo viaja a una sesión con `admin:module_management`,
 * que es el mismo permiso que ya protege `/admin/modulos`, la pantalla que
 * muestra esta medición.
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getPlatformHealth } from "@/lib/services/platform-health"

export async function GET() {
  const result = await getPlatformHealth()
  const httpStatus = result.status === "error" ? 503 : 200

  // La sesión se resuelve sin `requirePermission` a propósito: esta ruta debe
  // seguir respondiendo un código HTTP válido sin credenciales, así que la
  // falta de sesión degrada el cuerpo, no lo convierte en 401.
  let detailAllowed = false
  try {
    detailAllowed = can(await auth(), "admin:module_management")
  } catch {
    detailAllowed = false
  }

  if (detailAllowed) return NextResponse.json(result, { status: httpStatus })

  // `degraded` se colapsa en `ok`: distinguirlo diría a un anónimo que algo
  // está fallando sin decirle qué, que es precisamente la señal que sobra.
  return NextResponse.json(
    { status: result.status === "error" ? "error" : "ok" },
    { status: httpStatus },
  )
}
