/**
 * GET /api/prevencion/cgrd/mapa/[name]
 *
 * Sirve un plano de riesgos previamente subido a `storage/risk-map/`. Mismo
 * guard IDOR que la evidencia PDTP: el nombre se valida contra
 * `isSafeStorageName` y contra la base — el archivo debe estar referenciado
 * por un `prevention_risk_map_layouts.image_path` dentro del alcance del
 * usuario.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { and, eq, inArray, type SQL } from "drizzle-orm"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveRiskMapFile, createRiskMapPath } from "@/lib/storage/config"
import { db } from "@/db"
import { preventionRiskMapLayouts } from "@/db/schema"
import { logger } from "@/lib/logger"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const relativePath = createRiskMapPath(name)
  const absolutePath = resolveRiskMapFile(relativePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") {
    return NextResponse.json({ error: "Plano no encontrado" }, { status: 404 })
  }

  try {
    const nameMatch = eq(preventionRiskMapLayouts.imagePath, relativePath)
    const where: SQL = scope.mode === "all"
      ? nameMatch
      : and(nameMatch, inArray(preventionRiskMapLayouts.worksiteId, scope.ids)) ?? nameMatch

    const [row] = await db.select({
      id: preventionRiskMapLayouts.id,
      imageMimeType: preventionRiskMapLayouts.imageMimeType,
      status: preventionRiskMapLayouts.status,
    })
      .from(preventionRiskMapLayouts)
      .where(where)
      .limit(1)
    if (!row) {
      return NextResponse.json({ error: "Plano no encontrado" }, { status: 404 })
    }

    // MIP-002: la consulta no miraba el estado, así que un plano ARCHIVADO se
    // servía exactamente igual que el vigente. Seguir sirviéndolo es
    // deliberado —el histórico de planos es evidencia—, pero indistinguible no:
    // quien lo pide tiene que poder saber que está mirando una versión
    // superada. Se declara en la respuesta y no se cachea, porque un plano
    // archivado no debe quedar cinco minutos en el caché del navegador
    // ocupando el lugar del vigente.
    //
    // PENDIENTE DE DECISIÓN: cuánto tiempo se conserva un plano archivado. La
    // plataforma no declara política de retención para el mapa de riesgos, así
    // que aquí no se borra nada por estado; el recolector
    // (`cleanupRiskMapOrphans`) sólo elimina archivos que NINGUNA fila
    // referencia.
    const archived = row.status !== "active"
    const buffer = await fs.readFile(absolutePath)
    const contentType = safeImageContentType(row.imageMimeType)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": archived ? "private, no-store" : "private, max-age=300",
        "X-Plano-Estado": archived ? "archivado" : "vigente",
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Plano no encontrado" }, { status: 404 })
    }
    logger.error("[miper/mapa GET]", err)
    return NextResponse.json({ error: "Error al servir el plano" }, { status: 500 })
  }
}

function safeImageContentType(mimeType: string): string {
  if (mimeType === "image/png" || mimeType === "image/jpeg") return mimeType
  return "application/octet-stream"
}
