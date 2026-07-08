import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentCategories, sstDocumentTypes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { sstDocumentCategoryUpsertSchema, sstDocumentTypeUpsertSchema } from "@/lib/validation/prevention"

export async function listDocumentCategories(activeOnly = false) {
  const rows = activeOnly
    ? await db.select().from(sstDocumentCategories).where(eq(sstDocumentCategories.isActive, true))
    : await db.select().from(sstDocumentCategories)
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export async function listDocumentTypes(categorySlug?: string) {
  if (categorySlug) {
    return db
      .select()
      .from(sstDocumentTypes)
      .where(and(eq(sstDocumentTypes.categorySlug, categorySlug), eq(sstDocumentTypes.isActive, true)))
      .orderBy(sstDocumentTypes.name)
  }
  return db.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.isActive, true)).orderBy(sstDocumentTypes.name)
}

export async function upsertDocumentCategory(input: unknown) {
  const data = sstDocumentCategoryUpsertSchema.parse(input)
  const now = new Date().toISOString()
  await db.insert(sstDocumentCategories).values({
    slug: data.slug,
    name: data.name,
    description: data.description || null,
    sortOrder: data.sortOrder,
    isActive: data.isActive,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: sstDocumentCategories.slug,
    set: { name: data.name, description: data.description || null, sortOrder: data.sortOrder, isActive: data.isActive, updatedAt: now },
  })
  const rows = await db.select().from(sstDocumentCategories).where(eq(sstDocumentCategories.slug, data.slug))
  return rows[0]
}

export async function upsertDocumentType(input: unknown) {
  const data = sstDocumentTypeUpsertSchema.parse(input)
  const now = new Date().toISOString()
  const id = data.id || `sdtype-${nanoid()}`
  await db.insert(sstDocumentTypes).values({
    id,
    categorySlug: data.categorySlug,
    code: data.code,
    name: data.name,
    description: data.description || null,
    defaultConfidentiality: data.defaultConfidentiality,
    defaultValidityMonths: data.defaultValidityMonths ?? null,
    requiresApproval: data.requiresApproval,
    requiresAcknowledgment: data.requiresAcknowledgment,
    isActive: data.isActive,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: sstDocumentTypes.id,
    set: {
      categorySlug: data.categorySlug, code: data.code, name: data.name,
      description: data.description || null, defaultConfidentiality: data.defaultConfidentiality,
      defaultValidityMonths: data.defaultValidityMonths ?? null,
      requiresApproval: data.requiresApproval, requiresAcknowledgment: data.requiresAcknowledgment,
      isActive: data.isActive, updatedAt: now,
    },
  })
  const rows = await db.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.id, id))
  return rows[0]
}

export const DEFAULT_CATEGORIES: Array<{ slug: string; name: string; description: string; sortOrder: number }> = [
  { slug: "gestion_preventiva", name: "Gestión preventiva", description: "Política, MIPER, mapas de riesgo, procedimientos, auditorías internas.", sortOrder: 10 },
  { slug: "legal_normativa", name: "Legal y normativa", description: "RIOHS, protocolos obligatorios, fiscalización, evidencias regulatorias.", sortOrder: 20 },
  { slug: "capacitacion", name: "Capacitación e inducciones", description: "Asistencia, materiales, certificados, inducciones, ODI.", sortOrder: 30 },
  { slug: "epp", name: "EPP", description: "Actas de entrega, reposición, fichas técnicas, certificaciones.", sortOrder: 40 },
  { slug: "incidentes", name: "Incidentes y accidentes", description: "Investigaciones, reportes, evidencias, medidas correctivas.", sortOrder: 50 },
  { slug: "comite", name: "Comité Paritario", description: "Constitución, actas, acuerdos, programas de trabajo.", sortOrder: 60 },
  { slug: "emergencias", name: "Emergencias", description: "Planes, planos, simulacros, brigadas, equipos de emergencia.", sortOrder: 70 },
  { slug: "equipos_vehiculos", name: "Equipos, vehículos y maquinaria", description: "Hojas SDS, fichas técnicas, mantenciones, certificaciones.", sortOrder: 80 },
  { slug: "fiscalizacion", name: "Fiscalización y auditorías", description: "Actas, observaciones, respuestas, planes de regularización.", sortOrder: 90 },
  { slug: "salud_ocupacional", name: "Salud ocupacional", description: "Protocolos MINSAL, aptitudes, restricciones.", sortOrder: 100 },
]

export async function seedDefaultCategories() {
  const now = new Date().toISOString()
  for (const c of DEFAULT_CATEGORIES) {
    await db.insert(sstDocumentCategories).values({
      slug: c.slug, name: c.name, description: c.description,
      sortOrder: c.sortOrder, isActive: true, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: sstDocumentCategories.slug,
      set: { name: c.name, description: c.description, sortOrder: c.sortOrder, isActive: true, updatedAt: now },
    })
  }
}

export async function setDocumentCategoryActive(slug: string, isActive: boolean) {
  const now = new Date().toISOString()
  const [row] = await db
    .update(sstDocumentCategories)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentCategories.slug, slug))
    .returning()
  if (!row) throw new Error("Categoría documental no encontrada")
  return row
}

export async function setDocumentTypeActive(id: string, isActive: boolean) {
  const now = new Date().toISOString()
  const [row] = await db
    .update(sstDocumentTypes)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentTypes.id, id))
    .returning()
  if (!row) throw new Error("Tipo documental no encontrado")
  return row
}
