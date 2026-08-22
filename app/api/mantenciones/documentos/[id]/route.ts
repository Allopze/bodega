export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { maintenanceDocuments, maintenanceRecords } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveMaintenanceDocumentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"
import { isRouteOperational } from "@/lib/services/module-toggles"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "mantenciones:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  if (!await isRouteOperational("/mantenciones")) return NextResponse.json({ error: "Módulo inactivo" }, { status: 503 })
  const { id } = await params
  const document = await db.query.maintenanceDocuments.findFirst({ where: eq(maintenanceDocuments.id, id) })
  if (!document) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  const record = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, document.maintenanceId), columns: { worksiteId: true } })
  if (!record?.worksiteId || !canAccessWorksite(session, record.worksiteId)) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  const absolutePath = resolveMaintenanceDocumentFile(document.filePath)
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, { headers: { "Content-Type": document.mimeType ?? "application/octet-stream", "Content-Disposition": encodeContentDisposition(document.fileName, "inline"), "Cache-Control": "private, max-age=60" } })
  } catch { return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 }) }
}
