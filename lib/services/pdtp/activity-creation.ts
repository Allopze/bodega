import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpResponsibleCatalog, pdtpSheets } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { addPdtpActivity, type PdtpActivityAddInput } from "./activities"
import { createCatalogActivity, publishCatalogActivity } from "./catalog-activities"
import { isUniqueViolation, resolveSheetForProgram } from "./helpers"

type Client = DB | Tx

function isTransactionHost(client: Client): client is DB {
  return typeof (client as DB).transaction === "function"
}

export type PdtpActivityDefinitionInput = {
  code: string
  title: string
  description: string
  executionGuidance: string
}

export type PdtpProgramActivityExecutionInput = Omit<
  PdtpActivityAddInput,
  "programId" | "catalogActivityId" | "activity" | "program" | "responsibleSlugs" | "responsibleDisplay" | "sheetCodes"
> & {
  responsibleSlug: string
}

export type CreatePublishedCatalogActivityInput = {
  programId: string
  definition: PdtpActivityDefinitionInput
  execution: PdtpProgramActivityExecutionInput
}

export type PdtpActivityCreationActor = {
  userId: string
  userEmail?: string
}

export class PdtpCatalogCodeConflictError extends Error {
  constructor() {
    super("Este código ya existe")
    this.name = "PdtpCatalogCodeConflictError"
  }
}

async function resolveDefaultSheetCode(programId: string, client: Client): Promise<string> {
  const general = await resolveSheetForProgram(programId, "pdtp_general", client)
  if (general?.isActive) return general.code

  const [fallback] = await client.select({ code: pdtpSheets.code }).from(pdtpSheets)
    .where(and(
      eq(pdtpSheets.isActive, true),
      or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)),
    ))
    .orderBy(
      sql`${pdtpSheets.programId} ASC NULLS LAST`,
      asc(pdtpSheets.code),
    )
    .limit(1)
  if (!fallback) throw new Error("El programa no tiene una hoja activa donde incorporar la actividad.")
  return fallback.code
}

export async function createPublishedCatalogActivityAndAddToProgram(
  input: CreatePublishedCatalogActivityInput,
  actor: PdtpActivityCreationActor,
  client: Client = db,
): Promise<{ catalogActivityId: string; annualActivityId: string; code: string }> {
  const create = async (tx: Client) => {
    const [responsible] = await tx.select({
      slug: pdtpResponsibleCatalog.slug,
      displayName: pdtpResponsibleCatalog.displayName,
    }).from(pdtpResponsibleCatalog).where(and(
      eq(pdtpResponsibleCatalog.slug, input.execution.responsibleSlug),
      eq(pdtpResponsibleCatalog.isActive, true),
    )).limit(1)
    if (!responsible) throw new Error("El responsable seleccionado no existe o está inactivo.")

    const sheetCode = await resolveDefaultSheetCode(input.programId, tx)
    const catalog = await createCatalogActivity({
      ...input.definition,
      createdByUserId: actor.userId,
    }, tx)
    await publishCatalogActivity(catalog.id, tx)

    const annual = await addPdtpActivity({
      ...input.execution,
      programId: input.programId,
      catalogActivityId: catalog.id,
      activity: input.definition.description,
      program: input.definition.executionGuidance,
      responsibleSlugs: [responsible.slug],
      responsibleDisplay: responsible.displayName,
      sheetCodes: [sheetCode],
    }, actor.userId, tx, true)

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "pdtp_catalog_activity",
      entityId: catalog.id,
      entityCode: catalog.code,
      newState: { status: "active", annualActivityId: annual.id, programId: input.programId },
    }, tx)

    return { catalogActivityId: catalog.id, annualActivityId: annual.id, code: catalog.code }
  }

  try {
    return await (isTransactionHost(client) ? client.transaction((tx) => create(tx)) : create(client))
  } catch (error) {
    if (isUniqueViolation(error)) throw new PdtpCatalogCodeConflictError()
    throw error
  }
}

export async function addCatalogActivityToProgram(input: {
  programId: string
  catalogActivityId: string
  execution: PdtpProgramActivityExecutionInput
}, actor: PdtpActivityCreationActor, client: Client = db): Promise<{ catalogActivityId: string; annualActivityId: string }> {
  const add = async (tx: Client) => {
    const [responsible] = await tx.select({
      slug: pdtpResponsibleCatalog.slug,
      displayName: pdtpResponsibleCatalog.displayName,
    }).from(pdtpResponsibleCatalog).where(and(
      eq(pdtpResponsibleCatalog.slug, input.execution.responsibleSlug),
      eq(pdtpResponsibleCatalog.isActive, true),
    )).limit(1)
    if (!responsible) throw new Error("El responsable seleccionado no existe o está inactivo.")
    const sheetCode = await resolveDefaultSheetCode(input.programId, tx)
    const annual = await addPdtpActivity({
      ...input.execution,
      programId: input.programId,
      catalogActivityId: input.catalogActivityId,
      activity: "Contenido resuelto desde catálogo",
      program: "Contenido resuelto desde catálogo",
      responsibleSlugs: [responsible.slug],
      responsibleDisplay: responsible.displayName,
      sheetCodes: [sheetCode],
    }, actor.userId, tx, true)
    return { catalogActivityId: input.catalogActivityId, annualActivityId: annual.id }
  }
  return isTransactionHost(client) ? client.transaction((tx) => add(tx)) : add(client)
}
