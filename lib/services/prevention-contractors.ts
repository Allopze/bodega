/**
 * lib/services/prevention-contractors.ts
 * Padrón de contratistas (Ley 20.123): empresas contratistas, sus trabajadores
 * destinados a la faena y su documentación habilitante. Entidad transversal,
 * sin alcance por faena (igual que legalDocuments / trainingCourses).
 */

import { and, desc, eq, isNotNull, lte } from "drizzle-orm"
import { db } from "@/db"
import { contractors, contractorWorkers, contractorDocuments } from "@/db/schema"
import type { ReportData } from "@/lib/reports/export"
import { nanoid } from "@/lib/id"
import {
  contractorCreateSchema,
  contractorWorkerAddSchema,
  contractorDocumentAddSchema,
} from "@/lib/validation/prevention"

export async function createContractor(input: unknown) {
  const data = contractorCreateSchema.parse(input)
  const now = new Date().toISOString()
  const [row] = await db.insert(contractors).values({
    id: `ctr-${nanoid()}`,
    rut: data.rut,
    name: data.name,
    legalRepresentative: data.legalRepresentative || null,
    contact: data.contact || null,
    status: data.status ?? "activo",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: contractors.rut,
    set: {
      name: data.name,
      legalRepresentative: data.legalRepresentative || null,
      contact: data.contact || null,
      status: data.status ?? "activo",
      updatedAt: now,
    },
  }).returning()
  if (!row) throw new Error("No se pudo registrar el contratista.")
  return row
}

export async function addContractorWorker(input: unknown) {
  const data = contractorWorkerAddSchema.parse(input)
  const [contractor] = await db.select().from(contractors).where(eq(contractors.id, data.contractorId)).limit(1)
  if (!contractor) throw new Error("Contratista no encontrado.")

  const now = new Date().toISOString()
  const [row] = await db.insert(contractorWorkers).values({
    id: `cwk-${nanoid()}`,
    contractorId: data.contractorId,
    workerId: data.workerId,
    position: data.position,
    startDate: data.startDate,
    endDate: data.endDate || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function addContractorDocument(input: unknown) {
  const data = contractorDocumentAddSchema.parse(input)
  const [contractor] = await db.select().from(contractors).where(eq(contractors.id, data.contractorId)).limit(1)
  if (!contractor) throw new Error("Contratista no encontrado.")

  const now = new Date().toISOString()
  const [row] = await db.insert(contractorDocuments).values({
    id: `cdoc-${nanoid()}`,
    contractorId: data.contractorId,
    type: data.type,
    versionId: data.versionId || null,
    status: data.status ?? "pendiente",
    expiresAt: data.expiresAt || null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return row
}

export async function listContractors(status?: string) {
  if (status) return db.select().from(contractors).where(eq(contractors.status, status))
  return db.select().from(contractors).orderBy(desc(contractors.createdAt))
}

export async function listContractorWorkers(contractorId: string) {
  return db.select().from(contractorWorkers).where(eq(contractorWorkers.contractorId, contractorId))
}

export async function listContractorDocuments(contractorId: string) {
  return db.select().from(contractorDocuments).where(eq(contractorDocuments.contractorId, contractorId))
}

export async function getContractor(id: string) {
  const [contractor] = await db.select().from(contractors).where(eq(contractors.id, id)).limit(1)
  if (!contractor) return null
  const [workersList, documents] = await Promise.all([
    listContractorWorkers(id),
    listContractorDocuments(id),
  ])
  return { ...contractor, workers: workersList, documents }
}

export async function getExpiringContractorDocuments(daysAhead = 30, today?: string) {
  const now = today ?? new Date().toISOString().slice(0, 10)
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + daysAhead)
  return db.select().from(contractorDocuments)
    .where(and(
      isNotNull(contractorDocuments.expiresAt),
      lte(contractorDocuments.expiresAt, horizon.toISOString().slice(0, 10)),
    ))
}

export async function buildContractorsExport(): Promise<ReportData> {
  const rows = await listContractors()
  return {
    filenameBase: "contratistas",
    worksheetName: "Contratistas",
    headers: ["ID", "RUT", "Razón social", "Representante legal", "Contacto", "Estado"],
    rows: rows.map((c) => [c.id, c.rut, c.name, c.legalRepresentative ?? "", c.contact ?? "", c.status]),
  }
}
