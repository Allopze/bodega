import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpPrograms,
  pdtpSheets,
  users as schemaUsers,
} from "@/db/schema"
import { countOf } from "@/lib/utils"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, isUniqueViolation, pdtpProgramId } from "./helpers"
import { ensureDefaultPdtpApprovalSteps } from "./approval-flow"
import { copyPdtpProgramContent, type PdtpProgramCopyReport } from "./program-copy"
import { remapPdtpDateToYear } from "./retirement"
import { getCurrentPdtpBase2026Version, getPdtpTemplateVersion, instantiatePdtpTemplateVersion } from "./templates"

type LegacyPdtpProgramCreateInput = {
  year: number; title: string; userId: string; copySheetsFromProgramId?: string; templateVersionId?: string; revisionFromProgramId?: string; appliesToAllWorksites?: boolean
}

export type PdtpAnnualProgramSource =
  | { kind: "previous_program"; programId: string }
  | { kind: "base" }

type ProgramRow = typeof pdtpPrograms.$inferSelect
type QueryClient = Tx | typeof db

/**
 * PREV-C03.1 (D20): la versión VIGENTE de un año, que es la única que se puede
 * copiar al año siguiente. Vigente es la activa o, con el año cerrado
 * formalmente, la última versión cerrada. Una v1 reemplazada por una v2 del
 * mismo año también está `closed`, pero su contenido ya fue superado: no se
 * ofrece.
 */
function currentVersionOfYear(versions: ProgramRow[]): ProgramRow | null {
  const active = versions.find((version) => version.status === "active")
  if (active) return active
  const yearClosed = versions
    .filter((version) => version.status === "closed" && version.yearClosedAt)
    .sort((left, right) => right.version - left.version)
  return yearClosed[0] ?? null
}

/**
 * El origen por omisión para crear `targetYear`: la versión vigente del año
 * elegible más reciente anterior al destino. `null` si no hay ninguno (queda la
 * Base preventiva 2026).
 */
export async function resolvePdtpCopySourceCandidate(targetYear: number, client: QueryClient = db): Promise<ProgramRow | null> {
  const programs = await client.select().from(pdtpPrograms)
    .where(lt(pdtpPrograms.year, targetYear))
    .orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
  const years = [...new Set(programs.map((program) => program.year))]
  for (const year of years) {
    const candidate = currentVersionOfYear(programs.filter((program) => program.year === year))
    if (candidate) return candidate
  }
  return null
}

/**
 * Una versión vigente por año, para ofrecer "Copiar el programa <año>" en la
 * creación. La pantalla elige la del año anterior más reciente al destino que
 * escriba el usuario, así que se entregan todas.
 */
export async function listPdtpCopySourceCandidates(): Promise<Array<{
  year: number
  programId: string
  version: number
  status: string
  activityCount: number
}>> {
  const programs = await db.select().from(pdtpPrograms).orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
  const candidates = [...new Set(programs.map((program) => program.year))]
    .map((year) => currentVersionOfYear(programs.filter((program) => program.year === year)))
    .filter((program): program is ProgramRow => program !== null)
  if (candidates.length === 0) return []
  const counts = await db.select({ programId: pdtpActivities.programId, total: sql<number>`count(*)::int` })
    .from(pdtpActivities)
    .where(and(inArray(pdtpActivities.programId, candidates.map((program) => program.id)), eq(pdtpActivities.status, "active")))
    .groupBy(pdtpActivities.programId)
  const countById = new Map(counts.map((row) => [row.programId, Number(row.total)]))
  return candidates.map((program) => ({
    year: program.year,
    programId: program.id,
    version: program.version,
    status: program.status,
    activityCount: countById.get(program.id) ?? 0,
  }))
}

async function assertCopyableSource(sourceProgramId: string, targetYear: number, client: QueryClient): Promise<ProgramRow> {
  const [source] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, sourceProgramId)).limit(1)
  if (!source) throw new Error("El programa de origen ya no existe.")
  if (source.year >= targetYear) throw new Error(`El programa de origen debe ser de un año anterior a ${targetYear}.`)
  const sameYear = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, source.year))
  const current = currentVersionOfYear(sameYear)
  if (!current || current.id !== source.id) {
    throw new Error(
      `Solo se puede copiar la versión vigente de ${source.year} (la activa o, con el año cerrado, la última versión cerrada)`
      + `${current ? `: v${current.version}` : ""}.`,
    )
  }
  return source
}

export type CreateAnnualPdtpProgramResult = {
  programId: string
  program: ProgramRow
  /** `false` si el año ya tenía un programa: no se crea otro ni se reemplaza. */
  created: boolean
  baseVersionId: string | null
  /** Informe de la copia (sólo al copiar un programa del año anterior). */
  copyReport?: PdtpProgramCopyReport
}

export async function createAnnualPdtpProgram(input: {
  year: number
  userId: string
  /**
   * De dónde sale el contenido. Por omisión (D20): la versión vigente del año
   * elegible más reciente; sin ninguno, la Base preventiva 2026.
   */
  source?: PdtpAnnualProgramSource
}): Promise<CreateAnnualPdtpProgramResult> {
  if (!Number.isInteger(input.year) || input.year < 2024 || input.year > 2100) {
    throw new Error("El año del programa debe estar entre 2024 y 2100.")
  }

  const existingResult = (existing: ProgramRow): CreateAnnualPdtpProgramResult => ({
    programId: existing.id, program: existing, created: false, baseVersionId: existing.sourceTemplateVersionId,
  })

  const create = async () => db.transaction(async (tx): Promise<CreateAnnualPdtpProgramResult> => {
    const [existing] = await tx.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, input.year))
      .orderBy(desc(pdtpPrograms.version))
      .limit(1)
    if (existing) return existingResult(existing)

    let source = input.source
    if (!source) {
      const candidate = await resolvePdtpCopySourceCandidate(input.year, tx)
      source = candidate ? { kind: "previous_program", programId: candidate.id } : { kind: "base" }
    }

    const [elaborator] = await tx.select({ name: schemaUsers.name }).from(schemaUsers)
      .where(eq(schemaUsers.id, input.userId))
      .limit(1)
    const now = new Date().toISOString()
    const programId = pdtpProgramId(input.year, 1)
    const elaboratedByName = elaborator?.name?.trim() || "Equipo de Prevención"
    const elaboratedByTitle = elaborator?.name?.trim() ? "Prevencionista" : "Sistema"

    if (source.kind === "previous_program") {
      const sourceProgram = await assertCopyableSource(source.programId, input.year, tx)
      const [program] = await tx.insert(pdtpPrograms).values({
        id: programId,
        year: input.year,
        version: 1,
        status: "draft",
        title: `Programa de Trabajo Preventivo SG-SST ${input.year}`,
        periodStart: `${input.year}-01-01`,
        periodEnd: `${input.year}-12-31`,
        // Cabecera del documento: se conserva el código y su revisión (no son
        // editables en el borrador); la vigencia se re-ancla al año nuevo.
        documentCode: sourceProgram.documentCode,
        documentRevision: sourceProgram.documentRevision,
        validFrom: sourceProgram.validFrom ? remapPdtpDateToYear(sourceProgram.validFrom, input.year) : null,
        validUntil: sourceProgram.validUntil ? remapPdtpDateToYear(sourceProgram.validUntil, input.year) : null,
        indicatorName: sourceProgram.indicatorName,
        indicatorType: sourceProgram.indicatorType,
        indicatorFormula: sourceProgram.indicatorFormula,
        indicatorPeriodicity: sourceProgram.indicatorPeriodicity,
        measurementOwner: sourceProgram.measurementOwner,
        complianceTarget: sourceProgram.complianceTarget,
        pesoEjecucion: sourceProgram.pesoEjecucion,
        pesoVerificacion: sourceProgram.pesoVerificacion,
        pesoCierre: sourceProgram.pesoCierre,
        // Sin esto, un programa corporativo sin faenas listadas no se podría
        // activar (PDTP-003).
        appliesToAllWorksites: sourceProgram.appliesToAllWorksites,
        creationMode: "program_copy",
        sourceProgramId: sourceProgram.id,
        sourceContentVersion: sourceProgram.contentVersion,
        // El linaje hacia la Base se conserva para la comparación con ella.
        sourceTemplateVersionId: sourceProgram.sourceTemplateVersionId,
        sourceMetadataJson: {
          copiedFrom: {
            programId: sourceProgram.id,
            year: sourceProgram.year,
            version: sourceProgram.version,
            contentVersion: sourceProgram.contentVersion,
            contentDigest: sourceProgram.contentDigest,
          },
        },
        elaboratedByUserId: input.userId,
        elaboratedByName,
        elaboratedByTitle,
        createdAt: now,
        updatedAt: now,
      }).returning()
      if (!program) throw new Error("No se pudo crear el programa anual.")

      const copyReport = await copyPdtpProgramContent(tx, {
        sourceProgram,
        targetProgramId: program.id,
        targetYear: input.year,
        mode: "next_year",
        userId: input.userId,
        now,
      })
      await addPdtpChangeLogEntry(
        program.id,
        1,
        input.userId,
        "lifecycle",
        null,
        { status: "draft", copiedFromProgramId: sourceProgram.id, copyReport },
        `Programa anual creado copiando ${sourceProgram.year} v${sourceProgram.version}: ${describePdtpCopyReport(copyReport)}`,
        tx,
      )
      return { programId: program.id, program, created: true, baseVersionId: sourceProgram.sourceTemplateVersionId, copyReport }
    }

    const base = await getCurrentPdtpBase2026Version(tx)
    if (!base) {
      throw new Error("La Base preventiva 2026 aún no está publicada. Instálala antes de crear programas anuales.")
    }
    const [program] = await tx.insert(pdtpPrograms).values({
      id: programId,
      year: input.year,
      version: 1,
      status: "draft",
      title: `Programa de Trabajo Preventivo SG-SST ${input.year}`,
      periodStart: `${input.year}-01-01`,
      periodEnd: `${input.year}-12-31`,
      creationMode: "base_2026",
      sourceProgramId: base.version.sourceProgramId,
      sourceContentVersion: base.version.sourceContentVersion,
      sourceTemplateVersionId: base.version.id,
      sourceMetadataJson: {
        baseCode: base.template.code,
        baseRevision: base.version.version,
        baseContentDigest: base.version.contentDigest,
      },
      elaboratedByUserId: input.userId,
      elaboratedByName,
      elaboratedByTitle,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!program) throw new Error("No se pudo crear el programa anual.")

    const { report: instantiationReport } = await instantiatePdtpTemplateVersion({
      templateVersionId: base.version.id,
      targetProgramId: program.id,
      targetYear: input.year,
      client: tx,
    })
    await ensureDefaultPdtpApprovalSteps(program.id, tx)
    const skipped = instantiationReport.skippedExecutionConfigs.length + instantiationReport.skippedReminderRules.length
      + instantiationReport.skippedExecutorAssignments.length + instantiationReport.skippedWorksiteRows.length
    await addPdtpChangeLogEntry(
      program.id,
      1,
      input.userId,
      "lifecycle",
      null,
      { status: "draft", baseTemplateVersionId: base.version.id, instantiationReport },
      `Programa anual creado desde Base preventiva 2026, revisión ${base.version.version}.`
        + (skipped > 0 ? ` ${countOf(skipped, "referencia omitida", "referencias omitidas")} por apuntar a registros que ya no existen.` : ""),
      tx,
    )
    return { programId: program.id, program, created: true, baseVersionId: base.version.id }
  })

  try {
    return await create()
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const [existing] = await db.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, input.year))
      .orderBy(desc(pdtpPrograms.version))
      .limit(1)
    if (!existing) throw error
    return existingResult(existing)
  }
}

/** Resumen legible del informe de copia, para el changelog y el aviso al usuario. */
export function describePdtpCopyReport(report: PdtpProgramCopyReport): string {
  const parts = [countOf(report.copiedActivities, "actividad copiada", "actividades copiadas")]
  if (report.skippedRetiredActivityNumbers.length > 0) {
    parts.push(`sin las retiradas N°${report.skippedRetiredActivityNumbers.join(", N°")}`)
  }
  const partial = report.scheduleNotes.filter((row) => row.notes.some((note) => note.kind === "partial_range")).map((row) => row.n)
  if (report.scheduleNotes.length > 0) {
    parts.push(countOf(report.scheduleNotes.length, "programación re-anclada", "programaciones re-ancladas")
      + (partial.length > 0 ? ` (rango parcial por revisar: N°${partial.join(", N°")})` : ""))
  }
  if (report.droppedScheduleOverrides > 0) parts.push(countOf(report.droppedScheduleOverrides, "ajuste por faena omitido", "ajustes por faena omitidos"))
  if (report.droppedSubjectCounts > 0) parts.push(countOf(report.droppedSubjectCounts, "padrón por faena en blanco", "padrones por faena en blanco"))
  if (report.skippedInactiveWorksiteIds.length > 0) parts.push(countOf(report.skippedInactiveWorksiteIds.length, "faena inactiva omitida", "faenas inactivas omitidas"))
  return `${parts.join("; ")}. No se copiaron ejecuciones, firmas ni asignaciones nominales (se traspasan al activar).`
}

/**
 * Constructor legado conservado exclusivamente para fixtures de regresión.
 * No se exporta por la interfaz productiva: la creación real siempre usa
 * `createAnnualPdtpProgram`.
 */
export async function createLegacyPdtpProgramForTests(input: LegacyPdtpProgramCreateInput) {
  const now = new Date().toISOString()
  const MAX_ATTEMPTS = 8
  // Este constructor sólo existe para conservar fixtures históricos. Antes de
  // PDTP-003 una instancia sin filas de membresía significaba alcance global;
  // los tests que lo usan deben seguir declarando ese contrato por defecto.
  const legacyInput = { ...input, appliesToAllWorksites: input.appliesToAllWorksites ?? true }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await createPdtpProgramAttempt(legacyInput, now)
    } catch (e) {
      // Violación de unique(year, version): otra creación concurrente para
      // el mismo año ganó la carrera del número de versión (el SELECT
      // MAX(version)+1 no es atómico entre transacciones). Reintentar
      // recalcula la versión contra lo que la otra transacción ya
      // committeó, en vez de rendirse a la primera colisión. El jitter
      // evita que varios competidores reintenten en el mismo instante y
      // vuelvan a pisarse entre sí (thundering herd).
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * (20 + Math.floor(Math.random() * 60))))
        continue
      }
      if (isUniqueViolation(e)) {
        throw new Error(`Ya se creó otra versión del programa ${input.year} al mismo tiempo. Intenta de nuevo.`)
      }
      throw e
    }
  }
  throw new Error("No se pudo crear el programa PDTP tras varios intentos concurrentes.")
}

/**
 * Abre una revisión v+1 sin tocar el programa activo de origen.
 *
 * El bloqueo de la fila fuente y la búsqueda del borrador abierto ocurren en
 * la misma transacción que crea el clon. Eso hace que dos clics concurrentes
 * devuelvan el mismo borrador en vez de generar dos revisiones para el año.
 */
export async function createPdtpRevision(input: { sourceProgramId: string; userId: string }) {
  const MAX_ATTEMPTS = 8
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const program = await createPdtpProgramAttempt({
        year: 0,
        title: "",
        userId: input.userId,
        revisionFromProgramId: input.sourceProgramId,
      }, new Date().toISOString())
      return { programId: program.id, program }
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * (20 + Math.floor(Math.random() * 60))))
        continue
      }
      if (isUniqueViolation(error)) {
        throw new Error("No se pudo reservar una versión nueva del programa. Intenta nuevamente.")
      }
      throw error
    }
  }
  throw new Error("No se pudo crear la revisión PDTP tras varios intentos concurrentes.")
}

async function createPdtpProgramAttempt(input: LegacyPdtpProgramCreateInput, now: string) {
  return db.transaction(async (tx) => {
      if (input.copySheetsFromProgramId && input.templateVersionId) {
        throw new Error("Selecciona un solo origen: plantilla o programa anterior.")
      }
      if (input.revisionFromProgramId && (input.copySheetsFromProgramId || input.templateVersionId)) {
        throw new Error("Una revisión sólo puede partir de un programa activo.")
      }
      if (input.revisionFromProgramId) {
        await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${input.revisionFromProgramId} FOR UPDATE`)
      }
      const sourceProgramId = input.revisionFromProgramId ?? input.copySheetsFromProgramId
      const sourceProgram = sourceProgramId
        ? (await tx.select().from(pdtpPrograms)
            .where(eq(pdtpPrograms.id, sourceProgramId))
            .limit(1))[0]
        : undefined
      if (sourceProgramId && !sourceProgram) {
        throw new Error("El programa de origen ya no existe.")
      }
      if (input.revisionFromProgramId && sourceProgram?.status !== "active") {
        throw new Error("Sólo se puede crear una revisión desde el programa activo.")
      }
      // La copia genérica conserva estructura pero se reancla al año que el
      // operador pidió. Sólo la revisión v+1 debe permanecer en el mismo año
      // que su programa activo de origen.
      const year = input.revisionFromProgramId && sourceProgram ? sourceProgram.year : input.year
      if (input.revisionFromProgramId && sourceProgram) {
        const [openRevision] = await tx.select().from(pdtpPrograms)
          .where(and(
            eq(pdtpPrograms.year, sourceProgram.year),
            eq(pdtpPrograms.sourceProgramId, sourceProgram.id),
            inArray(pdtpPrograms.status, ["draft", "in_review"]),
          ))
          .orderBy(desc(pdtpPrograms.version))
          .limit(1)
        if (openRevision) return openRevision
      }
      const existingVersion = await tx.select({ version: pdtpPrograms.version })
        .from(pdtpPrograms)
        .where(eq(pdtpPrograms.year, year))
        .orderBy(desc(pdtpPrograms.version)).limit(1)
      const version = (existingVersion[0]?.version ?? 0) + 1
      const programId = pdtpProgramId(year, version)
      const templateVersion = input.templateVersionId
        ? await getPdtpTemplateVersion(input.templateVersionId, tx)
        : null
      if (input.templateVersionId && !templateVersion) {
        throw new Error("La versión de plantilla seleccionada ya no existe.")
      }

      const [elaborator] = await tx
        .select({ name: schemaUsers.name })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, input.userId))
        .limit(1)
      const elaboratedByName = elaborator?.name?.trim() || "Equipo de Prevención"
      const elaboratedByTitle = elaborator?.name?.trim() ? "Prevencionista" : "Sistema"

      const [program] = await tx.insert(pdtpPrograms).values({
        id: programId,
        year,
        version,
        status: "draft",
        title: sourceProgram?.title ?? input.title,
        periodStart: sourceProgram?.periodStart ?? `${year}-01-01`,
        periodEnd: sourceProgram?.periodEnd ?? `${year}-12-31`,
        documentCode: sourceProgram?.documentCode ?? null,
        documentRevision: sourceProgram?.documentRevision ?? null,
        validFrom: sourceProgram?.validFrom ?? null,
        validUntil: sourceProgram?.validUntil ?? null,
        indicatorName: sourceProgram?.indicatorName ?? null,
        indicatorType: sourceProgram?.indicatorType ?? null,
        indicatorFormula: sourceProgram?.indicatorFormula ?? null,
        indicatorPeriodicity: sourceProgram?.indicatorPeriodicity ?? null,
        measurementOwner: sourceProgram?.measurementOwner ?? null,
        complianceTarget: sourceProgram?.complianceTarget ?? 0.9,
        pesoEjecucion: sourceProgram?.pesoEjecucion ?? 0.5,
        pesoVerificacion: sourceProgram?.pesoVerificacion ?? 0.3,
        pesoCierre: sourceProgram?.pesoCierre ?? 0.2,
        appliesToAllWorksites: sourceProgram?.appliesToAllWorksites ?? input.appliesToAllWorksites ?? false,
        creationMode: templateVersion ? "template" : sourceProgram ? "program_copy" : "blank",
        sourceProgramId: templateVersion?.sourceProgramId ?? sourceProgram?.id ?? null,
        sourceContentVersion: templateVersion?.sourceContentVersion ?? sourceProgram?.contentVersion ?? null,
        sourceTemplateVersionId: templateVersion?.id ?? sourceProgram?.sourceTemplateVersionId ?? null,
        sourceMetadataJson: sourceProgram
          ? { ...(sourceProgram.sourceMetadataJson as Record<string, unknown>), revisionFrom: { programId: sourceProgram.id, contentVersion: sourceProgram.contentVersion } }
          : {},
        elaboratedByUserId: input.userId, elaboratedByName, elaboratedByTitle,
        createdAt: now, updatedAt: now,
      }).returning()
      if (!program) throw new Error("No se pudo crear el programa PDTP.")

      if (templateVersion) {
        await instantiatePdtpTemplateVersion({
          templateVersionId: templateVersion.id,
          targetProgramId: programId,
          targetYear: year,
          client: tx,
        })
      } else if (sourceProgram) {
        // PREV-C03.1: la copia de contenido vive en un solo lugar
        // (`program-copy.ts`), compartida con la copia al año siguiente.
        await copyPdtpProgramContent(tx, {
          sourceProgram,
          targetProgramId: programId,
          targetYear: year,
          mode: "revision",
          userId: input.userId,
          now,
        })
      } else {
        await ensureDefaultPdtpApprovalSteps(programId, tx)
        // Vista única por defecto para un programa en blanco: no asume la
        // estructura de ocho hojas de la plantilla 2026.
        await tx.insert(pdtpSheets).values({
          id: `${programId}-pdtp_general`, code: "pdtp_general", programId,
          label: "Vista general", area: "prevencion", defaultScopeRoles: ["prevencionista", "administrador"],
        })
      }

      await addPdtpChangeLogEntry(
        programId,
        version,
        input.userId,
        "lifecycle",
        null,
        { status: "draft", revisionFromProgramId: input.revisionFromProgramId ?? null },
        input.revisionFromProgramId
          ? `Revisión v${version} creada desde ${input.revisionFromProgramId}; se copiaron estructura y configuración, no ejecuciones ni firmas.`
          : "Programa creado.",
        tx,
      )
      return program
  })
}

export async function updatePdtpProgram(programId: string, input: { title?: string; complianceTarget?: number }, userId: string) {
  // Lock + re-chequeo dentro de la transacción: sin esto, un submit-a-revisión
  // concurrente podía confirmar entre el SELECT plano y el UPDATE, mutando un
  // programa ya bloqueado (mismo patrón que el resto del módulo).
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const now = new Date().toISOString()
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const updates: Partial<typeof pdtpPrograms.$inferInsert> = { updatedAt: now }

    if (input.title !== undefined && input.title !== program.title) {
      before.title = program.title; after.title = input.title; updates.title = input.title
    }
    if (input.complianceTarget !== undefined && input.complianceTarget !== program.complianceTarget) {
      before.complianceTarget = program.complianceTarget; after.complianceTarget = input.complianceTarget
      updates.complianceTarget = input.complianceTarget
    }

    const [updated] = await tx.update(pdtpPrograms).set(updates).where(eq(pdtpPrograms.id, programId)).returning()
    if (!updated) throw new Error("No se pudo actualizar el programa PDTP.")

    if (Object.keys(after).length > 0) {
      await addPdtpChangeLogEntry(programId, program.version, userId, "metadata", before, after, "Metadatos actualizados.", tx)
    }
    return updated
  })
}

export async function listPdtpPrograms(opts?: { status?: string; year?: number }) {
  const conditions = []
  if (opts?.status) conditions.push(eq(pdtpPrograms.status, opts.status))
  if (opts?.year) conditions.push(eq(pdtpPrograms.year, opts.year))
  return db.select().from(pdtpPrograms).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
}

export async function getPdtpProgram(programId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  return program ?? null
}

export async function deletePdtpProgram(programId: string) {
  // Lock + re-chequeo: borrar en carrera con un submit-a-revisión cascadearía
  // hojas/actividades/ejecuciones de un programa que ya entró a revisión.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpPrograms} WHERE id = ${programId} FOR UPDATE`)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    // El delete cascadea a hojas/actividades/schedule/ejecuciones/overrides/
    // change_log (FK ON DELETE CASCADE). No escribimos un changelog "programa
    // eliminado" después: el programa ya no existe, y la fila violaría su
    // propia FK (además, el cascade ya borró el historial previo).
    await tx.delete(pdtpPrograms).where(eq(pdtpPrograms.id, programId))
  })
}
