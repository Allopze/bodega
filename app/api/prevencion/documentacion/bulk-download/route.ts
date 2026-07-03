export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { promises as fs } from "node:fs"
import { basename, extname } from "node:path"
import { NextResponse } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { sstDocuments, sstDocumentVersions } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { resolveSstDocumentFile } from "@/lib/storage/config"
import { encodeContentDisposition } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { recordDocumentDownload } from "@/lib/services/prevention-documents-library"

const MAX_BULK_DOCUMENTS = 50

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })

  const ids = Array.from(new Set(new URL(request.url).searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) ?? []))
    .slice(0, MAX_BULK_DOCUMENTS)
  if (ids.length === 0) return NextResponse.json({ error: "Selecciona al menos un documento" }, { status: 400 })

  const rows = await db
    .select({
      documentId: sstDocuments.id,
      title: sstDocuments.title,
      worksiteId: sstDocuments.worksiteId,
      status: sstDocuments.status,
      versionId: sstDocumentVersions.id,
      fileName: sstDocumentVersions.fileName,
      filePath: sstDocumentVersions.filePath,
    })
    .from(sstDocuments)
    .innerJoin(sstDocumentVersions, eq(sstDocumentVersions.id, sstDocuments.currentVersionId))
    .where(and(inArray(sstDocuments.id, ids), eq(sstDocuments.status, "vigente")))

  const files: Array<{ name: string; data: Buffer }> = []
  for (const row of rows) {
    if (row.worksiteId && !canAccessWorksite(session, row.worksiteId)) continue
    const absolutePath = resolveSstDocumentFile(row.filePath)
    if (!absolutePath) continue
    try {
      const data = await fs.readFile(absolutePath)
      files.push({ name: uniqueZipName(files.map((file) => file.name), row.title, row.fileName), data })
      await recordDocumentDownload({
        documentId: row.documentId,
        versionId: row.versionId,
        userId: session.user.id,
        source: "bulk-download",
      })
    } catch (err) {
      logger.warn("[documentacion/bulk-download] no se pudo incluir archivo", { documentId: row.documentId, err })
    }
  }

  if (files.length === 0) return NextResponse.json({ error: "No hay archivos vigentes descargables" }, { status: 404 })

  return new Response(createZip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": encodeContentDisposition("documentacion-preventiva.zip", "attachment"),
      "Cache-Control": "private, max-age=30",
    },
  })
}

function uniqueZipName(existing: string[], title: string, fileName: string) {
  const extension = extname(fileName)
  const base = sanitizeZipSegment(title || basename(fileName, extension)) || "documento"
  let candidate = `${base}${extension}`
  let index = 2
  while (existing.includes(candidate)) {
    candidate = `${base}-${index}${extension}`
    index += 1
  }
  return candidate
}

function sanitizeZipSegment(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function createZip(files: Array<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8")
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, file.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + file.data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
