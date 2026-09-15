import { and, eq } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
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

const numbersOrNull = (values: number[] | undefined) => values && values.length > 0 ? values : null

export async function upsertDocumentType(input: unknown, client: DB | Tx = db) {
  const data = sstDocumentTypeUpsertSchema.parse(input)
  // El schema valida el formato del slug; la existencia se verifica acá contra
  // la tabla, que es la fuente de verdad que el admin puede extender.
  const [category] = await client
    .select({ slug: sstDocumentCategories.slug })
    .from(sstDocumentCategories)
    .where(eq(sstDocumentCategories.slug, data.categorySlug))
  if (!category) throw new Error("La categoría indicada no existe")
  const now = new Date().toISOString()
  const id = data.id || `sdtype-${nanoid()}`
  await client.insert(sstDocumentTypes).values({
    id,
    categorySlug: data.categorySlug,
    code: data.code,
    name: data.name,
    description: data.description || null,
    defaultConfidentiality: data.defaultConfidentiality,
    defaultValidityMonths: data.defaultValidityMonths ?? null,
    requiresApproval: data.requiresApproval,
    requiresAcknowledgment: data.requiresAcknowledgment,
    pdtpActivityNumbers: numbersOrNull(data.pdtpActivityNumbers),
    pdtpAcknowledgmentActivityNumbers: numbersOrNull(data.pdtpAcknowledgmentActivityNumbers),
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
      // Omitidos = se conservan. Ver el schema: con identidades cableadas los
      // números son snapshot histórico, no configuración vigente.
      ...(data.pdtpActivityNumbers === undefined ? {} : { pdtpActivityNumbers: numbersOrNull(data.pdtpActivityNumbers) }),
      ...(data.pdtpAcknowledgmentActivityNumbers === undefined
        ? {}
        : { pdtpAcknowledgmentActivityNumbers: numbersOrNull(data.pdtpAcknowledgmentActivityNumbers) }),
      isActive: data.isActive, updatedAt: now,
    },
  })
  const rows = await client.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.id, id))
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

/**
 * Tipos documentales que la normativa exige por nombre, no por conveniencia.
 *
 * El RIOHS (DS 44 arts. 56-61) es obligatorio para toda entidad empleadora y
 * debe entregarse nominativamente a la dotación — de ahí
 * `requiresAcknowledgment`. Su contenido mínimo lo verifica el gate de
 * publicación en `workflow.ts`, contra `lib/prevention/riohs.ts`.
 */
export const DEFAULT_DOCUMENT_TYPES: Array<{
  categorySlug: string
  code: string
  name: string
  description: string
  requiresAcknowledgment: boolean
  defaultValidityMonths: number | null
  /** Actividades que acredita **publicar** una versión. */
  pdtpActivityNumbers?: number[]
  /** Actividades que acredita **cada acuse de recibo**. */
  pdtpAcknowledgmentActivityNumbers?: number[]
}> = [
  {
    categorySlug: "legal_normativa",
    code: "RIOHS",
    name: "Reglamento Interno de Higiene y Seguridad",
    description: "DS 44 arts. 56-61. Contenido mínimo del art. 58, entrega nominativa a toda la dotación.",
    requiresAcknowledgment: true,
    defaultValidityMonths: 12,
  },
  // ── Tipos derivados del RE-08 ───────────────────────────────────────────
  //
  // El listado maestro no declara el tipo en ninguna columna —la de "TIPO
  // DOCUMENTO" dice "Interno" en las 99 filas—, así que se deriva del prefijo
  // del código y del nombre.
  //
  // **Ninguno lleva `pdtpActivityNumbers`, y eso es deliberado.** Tipar como
  // `PTS` los dieciocho procedimientos operativos del listado (DO-14 Ampliroll,
  // DO-15 Maquinaria pesada, DO-23 Retroexcavadora…) haría que el día que se
  // publiquen sus versiones se acrediten dieciocho unidades de una actividad
  // planificada por mes. Reservar el `PTS` para los procedimientos de tarea
  // crítica es una decisión de Prevención, documento por documento, no de un
  // sembrador.
  { categorySlug: "gestion_preventiva", code: "PROC", name: "Procedimiento", description: "Procedimiento documentado del sistema de gestión integrado.", requiresAcknowledgment: false, defaultValidityMonths: null },
  { categorySlug: "gestion_preventiva", code: "INSTR", name: "Instructivo", description: "Instructivo operativo de una tarea concreta.", requiresAcknowledgment: false, defaultValidityMonths: null },
  { categorySlug: "gestion_preventiva", code: "POL", name: "Política", description: "Política declarada por la Gerencia General.", requiresAcknowledgment: true, defaultValidityMonths: null },
  { categorySlug: "gestion_preventiva", code: "PROG", name: "Programa o plan de gestión", description: "Programa anual o plan de gestión de un ámbito del sistema.", requiresAcknowledgment: false, defaultValidityMonths: 12 },
  { categorySlug: "gestion_preventiva", code: "MATRIZ", name: "Matriz o listado maestro", description: "Matriz de identificación, evaluación o control, y listados maestros.", requiresAcknowledgment: false, defaultValidityMonths: null },
  { categorySlug: "gestion_preventiva", code: "FORMATO", name: "Formato de registro", description: "Formato en blanco que se completa cada vez que se ejecuta la actividad.", requiresAcknowledgment: false, defaultValidityMonths: null },
  {
    // N°43. El hecho es que exista una versión vigente del procedimiento, así
    // que acredita al publicar. No exige acuse: la actividad del catálogo dice
    // "realizar y revisar", no difundir.
    categorySlug: "gestion_preventiva",
    code: "PTS",
    name: "Procedimiento de trabajo seguro",
    description: "Procedimientos de trabajo seguro por tarea crítica. Acredita la N°43 del programa al publicar una versión.",
    requiresAcknowledgment: false,
    defaultValidityMonths: 24,
    pdtpActivityNumbers: [43],
  },
  {
    // N°36. Acá el hecho es el opuesto: la difusión se prueba con los acuses,
    // no con la publicación. El número va SÓLO en la columna de acuse — en la
    // otra, publicar la matriz saldaría el mes de una difusión que nadie
    // recibió.
    categorySlug: "gestion_preventiva",
    code: "MIPER-DIF",
    name: "Difusión de la matriz de riesgos MIPER",
    description: "Difusión de la matriz MIPER a la dotación. Acredita la N°36 por cobertura, un acuse a la vez.",
    requiresAcknowledgment: true,
    defaultValidityMonths: 12,
    pdtpAcknowledgmentActivityNumbers: [36],
  },
]

export async function seedDefaultDocumentTypes() {
  const now = new Date().toISOString()
  for (const type of DEFAULT_DOCUMENT_TYPES) {
    await db.insert(sstDocumentTypes).values({
      id: `sstdt-${type.categorySlug}-${type.code.toLowerCase()}`,
      categorySlug: type.categorySlug,
      code: type.code,
      name: type.name,
      description: type.description,
      requiresApproval: true,
      requiresAcknowledgment: type.requiresAcknowledgment,
      defaultValidityMonths: type.defaultValidityMonths,
      pdtpActivityNumbers: type.pdtpActivityNumbers ?? null,
      pdtpAcknowledgmentActivityNumbers: type.pdtpAcknowledgmentActivityNumbers ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [sstDocumentTypes.categorySlug, sstDocumentTypes.code],
      set: {
        name: type.name,
        description: type.description,
        requiresAcknowledgment: type.requiresAcknowledgment,
        defaultValidityMonths: type.defaultValidityMonths,
        // El cableado al PDTP entra en el UPDATE y no sólo en el INSERT: un
        // catálogo sembrado antes de que estas columnas existieran se queda
        // sin ellas para siempre si el conflicto no las corrige.
        pdtpActivityNumbers: type.pdtpActivityNumbers ?? null,
        pdtpAcknowledgmentActivityNumbers: type.pdtpAcknowledgmentActivityNumbers ?? null,
        isActive: true,
        updatedAt: now,
      },
    })
  }
}

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
  // Los tipos referencian `categorySlug`, así que van después de las categorías.
  await seedDefaultDocumentTypes()
}

export async function setDocumentCategoryActive(slug: string, isActive: boolean) {
  const [current] = await db
    .select({ isActive: sstDocumentCategories.isActive })
    .from(sstDocumentCategories)
    .where(eq(sstDocumentCategories.slug, slug))
  if (!current) throw new Error("Categoría documental no encontrada")
  const now = new Date().toISOString()
  const [row] = await db
    .update(sstDocumentCategories)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentCategories.slug, slug))
    .returning()
  return { row: row!, previousIsActive: current.isActive }
}

export async function setDocumentTypeActive(id: string, isActive: boolean) {
  const [current] = await db
    .select({ isActive: sstDocumentTypes.isActive })
    .from(sstDocumentTypes)
    .where(eq(sstDocumentTypes.id, id))
  if (!current) throw new Error("Tipo documental no encontrado")
  const now = new Date().toISOString()
  const [row] = await db
    .update(sstDocumentTypes)
    .set({ isActive, updatedAt: now })
    .where(eq(sstDocumentTypes.id, id))
    .returning()
  return { row: row!, previousIsActive: current.isActive }
}
