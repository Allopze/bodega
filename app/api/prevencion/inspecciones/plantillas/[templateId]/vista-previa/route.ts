/**
 * GET /api/prevencion/inspecciones/plantillas/[templateId]/vista-previa
 *
 * El cuestionario de una plantilla en solo lectura, con su historial de
 * versiones y el detalle técnico para cotejarla contra el anexo oficial. La hoja
 * del catálogo lo pide al abrirse: el snapshot de cada plantilla pesa mucho
 * más que el resumen que necesita la tabla, y una lectura no revalida nada, así
 * que no cabe en una server action (que además es un archivo compartido).
 */
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { getInspectionTemplatePreview } from "@/lib/services/prevention-inspections/template-preview"
import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { logger } from "@/lib/logger"

const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE })
  if (!can(session, "prevention:inspections:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403, headers: NO_STORE })
  }

  const { templateId } = await params
  try {
    // Mismo toggle que las server actions y los Excel: con el submódulo apagado
    // tampoco se lee el cuestionario por la puerta de atrás.
    await assertInspectionOperationEnabled()
    const preview = await getInspectionTemplatePreview(templateId, {
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    })
    if (!preview) return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404, headers: NO_STORE })
    return NextResponse.json(preview, { status: 200, headers: NO_STORE })
  } catch (error) {
    if (error instanceof ModuleDisabledError) {
      return NextResponse.json({ error: "El submódulo Inspecciones está desactivado." }, { status: 403, headers: NO_STORE })
    }
    logger.error("[prevencion/inspecciones/plantillas/vista-previa]", error)
    return NextResponse.json({ error: "No se pudo cargar el cuestionario." }, { status: 500, headers: NO_STORE })
  }
}
