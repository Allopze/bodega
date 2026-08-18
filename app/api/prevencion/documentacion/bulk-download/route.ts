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
import { canReadDocumentConfidentiality } from "@/lib/services/prevention-documents/utils"

const MAX_BULK_DOCUMENTS = 50
const MAX_BULK_BYTES = 250_000_000 // 250 MB

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
      confidentiality: sstDocuments.confidentiality,
      versionId: sstDocumentVersions.id,
      fileName: sstDocumentVersions.fileName,
      filePath: sstDocumentVersions.filePath,
    })
    .from(sstDocuments)
    .innerJoin(sstDocumentVersions, eq(sstDocumentVersions.id, sstDocuments.currentVersionId))
    .where(and(
      inArray(sstDocuments.id, ids),
      eq(sstDocuments.status, "vigente"),
      eq(sstDocumentVersions.status, "vigente"),
    ))

  const readableRows = rows.flatMap((row) => {
    if (row.worksiteId && !canAccessWorksite(session, row.worksiteId)) return []
    if (!canReadDocumentConfidentiality(row.confidentiality, session.user.permissions)) return []
    const absolutePath = resolveSstDocumentFile(row.filePath)
    return absolutePath ? [{ row, absolutePath }] : []
  })
  // El tope agregado se decide con `stat`, ANTES de leer los archivos a memoria.
  // Leyendo primero (50 × 25 MB) el pico eran ~1,25 GB de Buffers, que el
  // `Buffer.concat` del ZIP volvía a duplicar, para después descartar lo que
  // sobraba del límite: se pagaba la memoria de todo lo que no se iba a entregar.
  const sized: Array<{ row: (typeof readableRows)[number]["row"]; absolutePath: string; size: number }> = []
  let plannedBytes = 0
  for (const { row, absolutePath } of readableRows) {
    let size: number
    try {
      size = (await fs.stat(absolutePath)).size
    } catch (err) {
      logger.warn("[documentacion/bulk-download] no se pudo incluir archivo", { documentId: row.documentId, err })
      continue
    }
    if (size > MAX_BULK_BYTES) {
      logger.warn("[documentacion/bulk-download] archivo excede el límite individual", { documentId: row.documentId, size })
      continue
    }
    if (plannedBytes + size > MAX_BULK_BYTES) {
      logger.warn("[documentacion/bulk-download] límite agregado de bytes excedido", { plannedBytes, max: MAX_BULK_BYTES })
      break
    }
    plannedBytes += size
    sized.push({ row, absolutePath, size })
  }

  const files: Array<{ name: string; data: Buffer }> = []
  const usedNames = new Set<string>()
  const delivered: typeof sized = []
  for (const entry of sized) {
    let data: Buffer
    try {
      data = await fs.readFile(entry.absolutePath)
    } catch (err) {
      logger.warn("[documentacion/bulk-download] no se pudo leer archivo", { documentId: entry.row.documentId, err })
      continue
    }
    const name = uniqueZipName(usedNames, entry.row.title, entry.row.fileName)
    usedNames.add(name)
    files.push({ name, data })
    delivered.push(entry)
  }

  // Se audita lo ENTREGADO, no lo leído: antes se registraban como descargados
  // los documentos descartados por el límite, así que la bitácora documental
  // —evidencia DS 44 de distribución— afirmaba entregas que nunca ocurrieron.
  await Promise.all(delivered.map(({ row }) => recordDocumentDownload({
    documentId: row.documentId,
    versionId: row.versionId,
    userId: session.user.id,
    source: "bulk-download",
  }).catch((err) => {
    logger.warn("[documentacion/bulk-download] no se pudo auditar descarga", { documentId: row.documentId, err })
  })))

  if (files.length === 0) return NextResponse.json({ error: "No hay archivos vigentes descargables" }, { status: 404 })

  return new Response(createZip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": encodeContentDisposition("documentacion-preventiva.zip", "attachment"),
      "Cache-Control": "private, no-store",
    },
  })
}

function uniqueZipName(existing: ReadonlySet<string>, title: string, fileName: string) {
  const extension = extname(fileName)
  const base = sanitizeZipSegment(title || basename(fileName, extension)) || "documento"
  let candidate = `${base}${extension}`
  let index = 2
  while (existing.has(candidate)) {
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
