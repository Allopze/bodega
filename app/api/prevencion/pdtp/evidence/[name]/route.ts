/**
 * GET /api/prevencion/pdtp/evidence/[name]
 *
 * Sirve un archivo de evidencia PDTP previamente subido a
 * `storage/pdtp-evidence/`. El nombre llega por URL y se valida contra
 * el `isSafeStorageName` (sin traversal) y contra la DB: el archivo debe
 * estar referenciado —por igualdad exacta de la ruta, PREV-M02-A— por una
 * ejecución, por la evidencia del plan de acción del PDTP o por una instancia
 * programada (PREV-I05) dentro del scope de faenas del usuario
 * (`findPdtpEvidenceOwner`).
 *
 * Auth: requiere sesión y permiso `prevention:pdtp:view`. Aplica
 * `assertWorksiteAccess` para impedir fuga cross-worksite.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { type NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { assertWorksiteAccess } from "@/lib/services/prevention-pdtp"
import { findPdtpEvidenceOwner } from "@/lib/services/pdtp/evidence-references"
import { logger } from "@/lib/logger"
import { UNTRUSTED_FILE_HEADERS } from "@/lib/security/file-response"

const PDTP_EVIDENCE_PREFIX = "storage/pdtp-evidence/"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:pdtp:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const { name } = await params
  const relativePath = `${PDTP_EVIDENCE_PREFIX}${name}`
  const absolutePath = resolvePdtpEvidenceFile(relativePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  // Verifica que la evidencia esté asociada a una ejecución dentro del
  // scope del usuario. Esto previene IDOR: no se puede descargar un
  // archivo adivinando el nombre sin tener acceso a la faena.
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") {
    return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
  }
  const scopeIds: string[] | "all" = scope.mode === "all" ? "all" : scope.ids

  try {
    const owner = await findPdtpEvidenceOwner(name, scopeIds)
    const ownerWorksite = owner?.worksiteId
    if (!ownerWorksite) {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    assertWorksiteAccess(ownerWorksite, scopeIds)

    const buffer = await fs.readFile(absolutePath)
    const contentType = inferContentType(name)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
        ...UNTRUSTED_FILE_HEADERS,
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // PREV-I13: la base referencia este archivo y el disco ya no lo tiene.
      // Al usuario le llega el mismo 404 que a un acceso denegado, pero la
      // pérdida queda registrada para poder detectarla y recuperarla.
      logger.warn({ name }, "[pdtp/evidence GET] evidencia referenciada sin archivo en disco")
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    if (err instanceof Error && /sin acceso a la faena/i.test(err.message)) {
      return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    }
    logger.error("[pdtp/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}

function inferContentType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return "application/octet-stream"
}
