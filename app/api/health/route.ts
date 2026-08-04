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
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getPlatformHealth } from "@/lib/services/platform-health"

export async function GET() {
  const result = await getPlatformHealth()
  const httpStatus = result.status === "error" ? 503 : 200
  return NextResponse.json(result, { status: httpStatus })
}
