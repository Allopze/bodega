export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { guardPermission } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole } from "@/lib/auth/scope"
import { db } from "@/db"
import {
  attachments, itAssets, itAssetAssignments, itMaintenances, itTickets,
  itAssetRetirements, itLicenseAssignments, workers,
} from "@/db/schema"
import { resolveTiFile, resolveDeliveryAttachmentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"

const TI_ENTITY_TYPES = new Set([
  "it_asset", "it_asset_assignment", "it_assignment", "it_maintenance", "it_ticket",
  "it_asset_retirement", "it_retirement", "it_license_assignment", "it_license",
])

/**
 * GET /api/ti/attachments/[id] — sirve documentos adjuntos del módulo TI
 * (facturas, órdenes de compra, documentos de mantención). Verifica que el
 * adjunto pertenezca a una entidad TI (anti-IDOR) antes de leer el disco.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardPermission("ti:view")
  if (guard.error) return new NextResponse("No autorizado", { status: 403 })

  const { id } = await params
  const [attachment] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
  if (!attachment) return new NextResponse("No encontrado", { status: 404 })
  if (!TI_ENTITY_TYPES.has(attachment.entityType)) {
    return new NextResponse("No encontrado", { status: 404 })
  }

  const worksiteId = await resolveAttachmentWorksite(attachment.entityType, attachment.entityId)
  if (
    worksiteId === undefined
    || (worksiteId === null && !isGlobalRole(guard.session))
    || (worksiteId && !canAccessWorksite(guard.session, worksiteId))
  ) {
    return new NextResponse("No encontrado", { status: 404 })
  }

  // Los adjuntos TI se guardan en storage/ti/; algunos legacy pueden vivir en
  // el prefijo de entregas. Se resuelve con el helper que corresponda.
  const absolutePath = resolveTiFile(attachment.filePath) ?? resolveDeliveryAttachmentFile(attachment.filePath)
  if (!absolutePath) return new NextResponse("No encontrado", { status: 404 })

  try {
    const file = await fs.readFile(absolutePath)
    return new Response(file, {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Content-Disposition": encodeContentDisposition(attachment.fileName, "inline"),
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch {
    return new NextResponse("No encontrado", { status: 404 })
  }
}

/** Resolves ownership before reading a file, so entity IDs cannot be used as an IDOR. */
async function resolveAttachmentWorksite(entityType: string, entityId: string): Promise<string | null | undefined> {
  switch (entityType) {
    case "it_asset": {
      const [row] = await db.select({ worksiteId: itAssets.worksiteId }).from(itAssets).where(eq(itAssets.id, entityId)).limit(1)
      return row?.worksiteId
    }
    case "it_asset_assignment":
    case "it_assignment": {
      const [row] = await db.select({ worksiteId: itAssetAssignments.worksiteId }).from(itAssetAssignments).where(eq(itAssetAssignments.id, entityId)).limit(1)
      return row?.worksiteId
    }
    case "it_maintenance": {
      const [row] = await db.select({ worksiteId: itAssets.worksiteId })
        .from(itMaintenances).innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
        .where(eq(itMaintenances.id, entityId)).limit(1)
      return row?.worksiteId
    }
    case "it_ticket": {
      const [row] = await db.select({ worksiteId: itTickets.worksiteId }).from(itTickets).where(eq(itTickets.id, entityId)).limit(1)
      return row?.worksiteId
    }
    case "it_asset_retirement":
    case "it_retirement": {
      const [row] = await db.select({ worksiteId: itAssets.worksiteId })
        .from(itAssetRetirements).innerJoin(itAssets, eq(itAssetRetirements.assetId, itAssets.id))
        .where(eq(itAssetRetirements.id, entityId)).limit(1)
      return row?.worksiteId
    }
    case "it_license_assignment": {
      const [row] = await db.select({
        worksiteId: itLicenseAssignments.worksiteId,
        workerWorksiteId: workers.worksiteId,
        assetWorksiteId: itAssets.worksiteId,
      })
        .from(itLicenseAssignments)
        .leftJoin(workers, eq(itLicenseAssignments.workerId, workers.id))
        .leftJoin(itAssets, eq(itLicenseAssignments.assetId, itAssets.id))
        .where(eq(itLicenseAssignments.id, entityId)).limit(1)
      return row?.worksiteId ?? row?.workerWorksiteId ?? row?.assetWorksiteId
    }
    case "it_license":
      // Licenses are global catalog records and are intentionally restricted to
      // global TI roles until the model carries a worksite owner.
      return null
    default:
      return undefined
  }
}
