/**
 * lib/services/prevention-legal-docs.ts
 * Documentación legal: RIOHS, ODI, IRL, programas (PDTP N° 15, 18, 19).
 */

import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { legalDocuments, legalDocumentVersions, documentDeliveries, documentSignatures } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"

export async function createLegalDocument(input: {
  type: string
  code: string
  title: string
  mandatory?: boolean
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(legalDocuments).values({
    id: `ldoc-${nanoid()}`,
    type: input.type,
    code: input.code,
    title: input.title,
    mandatory: input.mandatory ?? true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [legalDocuments.type, legalDocuments.code],
    set: { title: input.title, mandatory: input.mandatory ?? true, updatedAt: now },
  }).returning()
  return row
}

export async function addDocumentVersion(input: {
  documentId: string
  effectiveFrom: string
  effectiveTo?: string
  fileUrl?: string
  changelog?: string
}, userId: string) {
  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, input.documentId)).limit(1)
  if (!doc) throw new Error("Documento no encontrado.")

  const versions = await db.select().from(legalDocumentVersions)
    .where(eq(legalDocumentVersions.documentId, input.documentId))
  const nextVersion = versions.length + 1

  const now = new Date().toISOString()
  const id = `ldv-${nanoid()}`
  const [row] = await db.insert(legalDocumentVersions).values({
    id,
    documentId: input.documentId,
    version: nextVersion,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    fileUrl: input.fileUrl ?? null,
    changelog: input.changelog ?? null,
    signedBy: userId,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function deliverDocument(input: {
  versionId: string
  workerId: string
  method?: string
  evidenceUrl?: string
}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(documentDeliveries).values({
    id: `ddel-${nanoid()}`,
    versionId: input.versionId,
    workerId: input.workerId,
    deliveredAt: now,
    method: input.method ?? "digital",
    evidenceUrl: input.evidenceUrl ?? null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [documentDeliveries.versionId, documentDeliveries.workerId],
    set: { deliveredAt: now, method: input.method ?? "digital", evidenceUrl: input.evidenceUrl ?? null, updatedAt: now },
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
