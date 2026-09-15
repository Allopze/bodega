import { and, asc, eq } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpCatalogActivities,
  pdtpCatalogActivityRevisions,
  pdtpPrograms,
} from "@/db/schema"
import { nanoid } from "@/lib/id"

type Client = DB | Tx

type CatalogContentInput = {
  title: string
  description: string
  executionGuidance: string
}

function cleanContent(input: CatalogContentInput) {
  const title = input.title.trim()
  const description = input.description.trim()
  const executionGuidance = input.executionGuidance.trim()
  if (title.length < 3 || title.length > 80) throw new Error("El título debe tener entre 3 y 80 caracteres.")
  if (description.length < 3) throw new Error("La descripción es obligatoria.")
  if (executionGuidance.length < 2) throw new Error("La guía de ejecución es obligatoria.")
  return { title, description, executionGuidance }
}

function normalizeCode(value: string) {
  const code = value.trim().toUpperCase()
  if (!/^PDT-[A-Z0-9][A-Z0-9-]{2,116}[A-Z0-9]$/.test(code)) {
    throw new Error("El código debe comenzar con PDT- y usar letras, números o guiones.")
  }
  return code
}

export async function listCatalogActivities(client: Client = db) {
  return client
    .select({
      id: pdtpCatalogActivities.id,
      code: pdtpCatalogActivities.code,
      status: pdtpCatalogActivities.status,
      currentRevision: pdtpCatalogActivities.currentRevision,
      title: pdtpCatalogActivityRevisions.title,
      description: pdtpCatalogActivityRevisions.description,
      executionGuidance: pdtpCatalogActivityRevisions.executionGuidance,
      retiredReason: pdtpCatalogActivities.retiredReason,
      updatedAt: pdtpCatalogActivities.updatedAt,
    })
    .from(pdtpCatalogActivities)
    .innerJoin(pdtpCatalogActivityRevisions, and(
      eq(pdtpCatalogActivityRevisions.catalogActivityId, pdtpCatalogActivities.id),
      eq(pdtpCatalogActivityRevisions.revision, pdtpCatalogActivities.currentRevision),
    ))
    .orderBy(asc(pdtpCatalogActivityRevisions.title), asc(pdtpCatalogActivities.code))
}

export async function listCatalogActivityRevisions(catalogActivityId: string, client: Client = db) {
  return client.select().from(pdtpCatalogActivityRevisions)
    .where(eq(pdtpCatalogActivityRevisions.catalogActivityId, catalogActivityId))
    .orderBy(asc(pdtpCatalogActivityRevisions.revision))
}

export async function createCatalogActivity(input: CatalogContentInput & {
  code: string
  createdByUserId?: string
}, client: Client = db): Promise<typeof pdtpCatalogActivities.$inferSelect> {
  if (client === db) return db.transaction((tx) => createCatalogActivity(input, tx))
  const now = new Date().toISOString()
  const id = `pdtp-catalog-${nanoid()}`
  const content = cleanContent(input)
  const [created] = await client.insert(pdtpCatalogActivities).values({
    id,
    code: normalizeCode(input.code),
    status: "draft",
    currentRevision: 1,
    createdByUserId: input.createdByUserId ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo crear la actividad de catálogo.")
  await client.insert(pdtpCatalogActivityRevisions).values({
    id: `${id}-r1`,
    catalogActivityId: id,
    revision: 1,
    ...content,
    changeNote: "Creación de la actividad",
    createdByUserId: input.createdByUserId ?? null,
    createdAt: now,
  })
  return created
}

export async function publishCatalogActivity(id: string, client: Client = db) {
  const now = new Date().toISOString()
  const [current] = await client.select().from(pdtpCatalogActivities).where(eq(pdtpCatalogActivities.id, id)).limit(1)
  if (!current) throw new Error("Actividad de catálogo no encontrada.")
  if (current.status === "retired") throw new Error("Una actividad retirada no puede volver a publicarse.")
  const [updated] = await client.update(pdtpCatalogActivities).set({ status: "active", updatedAt: now })
    .where(eq(pdtpCatalogActivities.id, id)).returning()
  return updated!
}

export async function createCatalogActivityRevision(input: CatalogContentInput & {
  catalogActivityId: string
  changeNote: string
  createdByUserId?: string
}, client: Client = db): Promise<typeof pdtpCatalogActivityRevisions.$inferSelect> {
  if (client === db) return db.transaction((tx) => createCatalogActivityRevision(input, tx))
  const note = input.changeNote.trim()
  if (note.length < 10) throw new Error("Explica el cambio en al menos 10 caracteres.")
  const [catalog] = await client.select().from(pdtpCatalogActivities)
    .where(eq(pdtpCatalogActivities.id, input.catalogActivityId)).limit(1)
  if (!catalog) throw new Error("Actividad de catálogo no encontrada.")
  if (catalog.status === "retired") throw new Error("No se puede revisar una actividad retirada.")
  const revision = catalog.currentRevision + 1
  const now = new Date().toISOString()
  const [created] = await client.insert(pdtpCatalogActivityRevisions).values({
    id: `${catalog.id}-r${revision}`,
    catalogActivityId: catalog.id,
    revision,
    ...cleanContent(input),
    changeNote: note,
    createdByUserId: input.createdByUserId ?? null,
    createdAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo crear la revisión.")
  const [updated] = await client.update(pdtpCatalogActivities).set({ currentRevision: revision, updatedAt: now })
    .where(and(eq(pdtpCatalogActivities.id, catalog.id), eq(pdtpCatalogActivities.currentRevision, catalog.currentRevision)))
    .returning({ id: pdtpCatalogActivities.id })
  if (!updated) throw new Error("La actividad cambió mientras se creaba la revisión; vuelve a intentarlo.")
  return created
}

export async function retireCatalogActivity(id: string, reason: string, client: Client = db, userId?: string) {
  const cleanReason = reason.trim()
  if (cleanReason.length < 10) throw new Error("Indica un motivo de retiro de al menos 10 caracteres.")
  const now = new Date().toISOString()
  const [updated] = await client.update(pdtpCatalogActivities).set({
    status: "retired",
    retiredReason: cleanReason,
    retiredByUserId: userId ?? null,
    retiredAt: now,
    updatedAt: now,
  }).where(eq(pdtpCatalogActivities.id, id)).returning()
  if (!updated) throw new Error("Actividad de catálogo no encontrada.")
  return updated
}

export async function adoptLatestCatalogRevision(annualActivityId: string, client: Client = db) {
  const [annual] = await client.select().from(pdtpActivities).where(eq(pdtpActivities.id, annualActivityId)).limit(1)
  if (!annual?.catalogActivityId) throw new Error("La actividad anual no tiene identidad de catálogo.")
  const [program] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, annual.programId)).limit(1)
  if (!program || program.status !== "draft") throw new Error("La revisión sólo puede adoptarse mientras el programa está editable.")
  const [catalog] = await client.select().from(pdtpCatalogActivities).where(eq(pdtpCatalogActivities.id, annual.catalogActivityId)).limit(1)
  if (!catalog) throw new Error("Actividad de catálogo no encontrada.")
  const [revision] = await client.select().from(pdtpCatalogActivityRevisions).where(and(
    eq(pdtpCatalogActivityRevisions.catalogActivityId, catalog.id),
    eq(pdtpCatalogActivityRevisions.revision, catalog.currentRevision),
  )).limit(1)
  if (!revision) throw new Error("La revisión vigente del catálogo no existe.")
  const [updated] = await client.update(pdtpActivities).set({
    catalogRevision: revision.revision,
    activity: revision.description,
    program: revision.executionGuidance,
    updatedAt: new Date().toISOString(),
  }).where(eq(pdtpActivities.id, annual.id)).returning()
  return updated!
}
