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
  sheetCode?: string
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

async function resolveDefaultSheetCode(programId: string, requestedCode: string | undefined, client: Client): Promise<string> {
  if (requestedCode) {
    const requested = await resolveSheetForProgram(programId, requestedCode, client)
    if (!requested?.isActive) throw new Error("La hoja seleccionada no existe o está inactiva.")
    return requested.code
  }

  const general = await resolveSheetForProgram(programId, "pdtp_general", client)
  if (general?.isActive) return general.code

  const [fallback] = await client.select({ code: pdtpSheets.code }).from(pdtpSheets)
    .where(and(
      eq(pdtpSheets.isActive, true),
      or(isNull(pdtpSheets.programId), eq(pdtpSheets.programId, programId)),
    ))
    .orderBy(sql`${pdtpSheets.programId} ASC NULLS LAST`, asc(pdtpSheets.code))
    .limit(1)
  if (!fallback) throw new Error("El programa no tiene una hoja activa donde incorporar la actividad.")
  return fallback.code
}

async function resolveResponsible(slug: string, client: Client) {
  const [responsible] = await client.select({
    slug: pdtpResponsibleCatalog.slug,
    displayName: pdtpResponsibleCatalog.displayName,
  }).from(pdtpResponsibleCatalog).where(and(
    eq(pdtpResponsibleCatalog.slug, slug),
    eq(pdtpResponsibleCatalog.isActive, true),
  )).limit(1)
  if (!responsible) throw new Error("El responsable seleccionado no existe o está inactivo.")
  return responsible
}

function annualInput(
  programId: string,
  catalogActivityId: string,
  definition: Pick<PdtpActivityDefinitionInput, "description" | "executionGuidance">,
  execution: PdtpProgramActivityExecutionInput,
  responsible: { slug: string; displayName: string },
  sheetCode: string,
): PdtpActivityAddInput {
  const { responsibleSlug: _responsibleSlug, sheetCode: _sheetCode, ...annualExecution } = execution
  return {
    ...annualExecution,
    programId,
    catalogActivityId,
    activity: definition.description,
    program: definition.executionGuidance,
    responsibleSlugs: [responsible.slug],
    responsibleDisplay: responsible.displayName,
    sheetCodes: [sheetCode],
  }
}

export async function createPublishedCatalogActivityAndAddToProgram(
  input: CreatePublishedCatalogActivityInput,
  actor: PdtpActivityCreationActor,
  client: Client = db,
): Promise<{ catalogActivityId: string; annualActivityId: string; code: string }> {
  const create = async (tx: Client) => {
    // Resolver todas las dependencias antes de la primera escritura mantiene el
    // error operativo cerca de su causa y evita trabajo que terminará en rollback.
    const responsible = await resolveResponsible(input.execution.responsibleSlug, tx)
    const sheetCode = await resolveDefaultSheetCode(input.programId, input.execution.sheetCode, tx)

    const catalog = await createCatalogActivity({
      ...input.definition,
      createdByUserId: actor.userId,
    }, tx)
    await publishCatalogActivity(catalog.id, tx)
    const annual = await addPdtpActivity(
      annualInput(input.programId, catalog.id, input.definition, input.execution, responsible, sheetCode),
      actor.userId,
      tx,
      true,
    )

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
    const responsible = await resolveResponsible(input.execution.responsibleSlug, tx)
    const sheetCode = await resolveDefaultSheetCode(input.programId, input.execution.sheetCode, tx)
    const annual = await addPdtpActivity(
      annualInput(input.programId, input.catalogActivityId, {
        description: "Contenido resuelto desde catálogo",
        executionGuidance: "Contenido resuelto desde catálogo",
      }, input.execution, responsible, sheetCode),
      actor.userId,
      tx,
      true,
    )
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "pdtp_program_activity",
      entityId: annual.id,
      entityCode: String(annual.n),
      newState: { catalogActivityId: input.catalogActivityId, programId: input.programId },
    }, tx)
    return { catalogActivityId: input.catalogActivityId, annualActivityId: annual.id }
  }
  return isTransactionHost(client) ? client.transaction((tx) => add(tx)) : add(client)
}
