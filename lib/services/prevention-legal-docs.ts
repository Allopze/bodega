/**
 * lib/services/prevention-legal-docs.ts
 * Documentación legal: RIOHS, ODI, IRL, programas (PDTP N° 15, 18, 19).
 */

import { desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { legalDocuments, legalDocumentVersions, documentDeliveries, documentSignatures } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  legalDocumentCreateSchema,
  legalDocumentVersionAddSchema,
  documentDeliveryCreateSchema,
} from "@/lib/validation/prevention"

export async function createLegalDocument(input: unknown) {
  const data = legalDocumentCreateSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(legalDocuments).values({
    id: `ldoc-${nanoid()}`,
    type: data.type,
    code: data.code,
    title: data.title,
    mandatory: data.mandatory ?? true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [legalDocuments.type, legalDocuments.code],
    set: { title: data.title, mandatory: data.mandatory ?? true, updatedAt: now },
  }).returning()
  return row
}

export async function addDocumentVersion(input: unknown, userId: string) {
  const data = legalDocumentVersionAddSchema.parse(input)
  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, data.documentId)).limit(1)
  if (!doc) throw new Error("Documento no encontrado.")

  const now = new Date().toISOString()
  const id = `ldv-${nanoid()}`

  // Single-statement atomic insert: computes `MAX(version)+1` inside the DB
  // so concurrent inserts produce consecutive versions instead of colliding on
  // the unique `(document_id, version)` index. Avoids the read-then-insert race
  // and the 23505 error it would raise under contention.
  const [row] = await db.insert(legalDocumentVersions).values({
    id,
    documentId: data.documentId,
    version: sql`(SELECT COALESCE(MAX(${legalDocumentVersions.version}), 0) + 1 FROM ${legalDocumentVersions} WHERE ${legalDocumentVersions.documentId} = ${data.documentId})`,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo || null,
    fileUrl: data.fileUrl || null,
    changelog: data.changelog || null,
    signedBy: userId,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function deliverDocument(input: unknown) {
  const data = documentDeliveryCreateSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(documentDeliveries).values({
    id: `ddel-${nanoid()}`,
    versionId: data.versionId,
    workerId: data.workerId,
    deliveredAt: now,
    method: data.method ?? "digital",
    evidenceUrl: data.evidenceUrl || null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [documentDeliveries.versionId, documentDeliveries.workerId],
    set: { deliveredAt: now, method: data.method ?? "digital", evidenceUrl: data.evidenceUrl || null, updatedAt: now },
  }).returning()
  return row
}

export async function acknowledgeDelivery(deliveryId: string, userId: string, signature: string, ip?: string) {
  const now = new Date().toISOString()
  await db.update(documentDeliveries)
    .set({ acknowledgedAt: now, updatedAt: now })
    .where(eq(documentDeliveries.id, deliveryId))

  const [row] = await db.insert(documentSignatures).values({
    id: `dsig-${nanoid()}`,
    deliveryId,
    userId,
    signature,
    signedAt: now,
    ip: ip ?? null,
  }).onConflictDoUpdate({
    target: [documentSignatures.deliveryId, documentSignatures.userId],
    set: { signature, signedAt: now },
  }).returning()
  return row
}

export async function listLegalDocuments(type?: string) {
  if (type) return db.select().from(legalDocuments).where(eq(legalDocuments.type, type))
  return db.select().from(legalDocuments).orderBy(desc(legalDocuments.type))
}

export async function buildLegalDocsExport(): Promise<ReportData> {
  const docs = await listLegalDocuments()
  return {
    filenameBase: "documentacion-legal",
    worksheetName: "Documentación",
    headers: ["Tipo", "Código", "Título", "Obligatorio"],
    rows: docs.map((d) => [d.type, d.code, d.title, d.mandatory ? "Sí" : "No"]),
  }
}
