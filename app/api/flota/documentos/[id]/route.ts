export const dynamic = "force-dynamic"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fleetVehicleDocuments, fuelVehicles } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveFleetDocumentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"
import { isRouteOperational } from "@/lib/services/module-toggles"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!can(session, "flota:view")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }
  if (!await isRouteOperational("/flota")) {
    return NextResponse.json({ error: "Módulo inactivo" }, { status: 503 })
  }

  const { id } = await params
  const document = await db.query.fleetVehicleDocuments.findFirst({
    where: eq(fleetVehicleDocuments.id, id),
  })
  if (!document) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  }

  if (document.vehicleId) {
    const vehicle = await db.query.fuelVehicles.findFirst({
      where: eq(fuelVehicles.id, document.vehicleId),
    })
    if (!vehicle?.worksiteId || !canAccessWorksite(session, vehicle.worksiteId)) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }
  }

  const absolutePath = resolveFleetDocumentFile(document.filePath)
  if (!absolutePath) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  }

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": document.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(document.fileName, "inline"),
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 })
  }
}
