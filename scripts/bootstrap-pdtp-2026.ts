import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { PDTP_2026_INVARIANTS, PDTP_2026_PROGRAM_SOURCE } from "../lib/services/pdtp-adapters/contract-2026"
import { extractPdtpCatalogFromWorkbook } from "../lib/services/prevention-pdtp-catalog"
import { validateLoadedWorkbook, validateXlsxEnvelope } from "../lib/services/xlsx-security"

type Strategy = "dry-run" | "stage" | "apply" | "rollback"
type WorksiteStrategy = "none" | "single"

type CliOptions = {
  file?: string
  year: number
  userId: string
  strategy: Strategy
  worksiteStrategy: WorksiteStrategy
  programId?: string
  batchId?: string
  worksiteId?: string
  acceptMissingEvidence: boolean
  reason?: string
  allowCompatibleSource: boolean
  publishReference: boolean
}

function usage() {
  return [
    "Uso:",
    "  npm run pdtp:bootstrap-2026 -- --file <programa.xlsx> --year 2026 --user-id <id> --strategy <dry-run|stage|apply> --worksite-strategy <none|single>",
    "  npm run pdtp:bootstrap-2026 -- --year 2026 --user-id <id> --strategy rollback --worksite-strategy none --batch-id <id> --reason <motivo>",
    "", 
    "Para stage/apply: --program-id <id>. La Base 2026 normalizada no importa ejecuciones y admite --worksite-strategy none.",
    "Use --allow-compatible-source sólo para una fixture compatible cuyo SHA-256 no sea el oficial congelado.",
    "Use --publish-reference para publicar la revisión inmutable de Base 2026.",
  ].join("\n")
}

function readArgs(argv: string[]) {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (!token.startsWith("--")) throw new Error(`Argumento no reconocido: ${token}`)
    const separator = token.indexOf("=")
    if (separator > 2) {
      values.set(token.slice(2, separator), token.slice(separator + 1))
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      values.set(key, next)
      index += 1
    } else flags.add(key)
  }
  return { values, flags }
}

function parseOptions(argv: string[]): CliOptions {
  const { values, flags } = readArgs(argv)
  const required = (key: string) => {
    const value = values.get(key)?.trim()
    if (!value) throw new Error(`Falta --${key}.`)
    return value
  }
  const strategy = required("strategy") as Strategy
  if (!["dry-run", "stage", "apply", "rollback"].includes(strategy)) throw new Error("--strategy debe ser dry-run, stage, apply o rollback.")
  const worksiteStrategy = required("worksite-strategy") as WorksiteStrategy
  if (!["none", "single"].includes(worksiteStrategy)) throw new Error("--worksite-strategy debe ser none o single.")
  const year = Number(required("year"))
  if (year !== 2026) throw new Error("Este adaptador dedicado exige --year 2026.")
  const programId = values.get("program-id")?.trim() || undefined
  const batchId = values.get("batch-id")?.trim() || undefined
  const worksiteId = values.get("worksite-id")?.trim() || undefined
  const reason = values.get("reason")?.trim() || undefined
  if (["stage", "apply"].includes(strategy) && !programId) throw new Error("Stage y apply exigen --program-id.")
  if (["dry-run", "stage", "apply"].includes(strategy) && !values.get("file")?.trim()) throw new Error("La estrategia seleccionada exige --file.")
  if (strategy === "rollback" && (!batchId || (reason?.length ?? 0) < 10)) {
    throw new Error("Rollback exige --batch-id y --reason de al menos 10 caracteres.")
  }
  if (strategy === "apply" && worksiteStrategy === "single" && !worksiteId) {
    throw new Error("La estrategia de faena single exige --worksite-id.")
  }
  return {
    file: values.get("file")?.trim() || undefined,
    year,
    userId: required("user-id"),
    strategy,
    worksiteStrategy,
    programId,
    batchId,
    worksiteId,
    reason,
    acceptMissingEvidence: flags.has("accept-missing-evidence"),
    allowCompatibleSource: flags.has("allow-compatible-source"),
    publishReference: flags.has("publish-reference"),
  }
}

function assertReferenceCounts(catalog: ReturnType<typeof extractPdtpCatalogFromWorkbook>) {
  const schedule = catalog.activities.flatMap((activity) => activity.schedule)
  const executions = catalog.importedExecutions ?? []
  const actual = {
    activities: catalog.activities.length,
    views: Object.keys(catalog.sheetActivities).length,
    plannedCells: schedule.length,
    plannedQuantity: schedule.reduce((sum, cell) => sum + cell.plannedQuantity, 0),
    executedCells: executions.length,
    executedQuantity: executions.reduce((sum, cell) => sum + cell.executedQuantity, 0),
  }
  const expected = {
    activities: PDTP_2026_INVARIANTS.activityCount,
    views: PDTP_2026_INVARIANTS.viewCount,
    plannedCells: PDTP_2026_INVARIANTS.plannedCellCount,
    plannedQuantity: PDTP_2026_INVARIANTS.plannedQuantityTotal,
    executedCells: 0,
    executedQuantity: PDTP_2026_INVARIANTS.executedQuantityTotal,
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`El archivo no cumple el contrato 2026. Esperado ${JSON.stringify(expected)}; recibido ${JSON.stringify(actual)}.`)
  }
  return actual
}

async function inspectSource(options: CliOptions) {
  const filePath = path.resolve(process.cwd(), options.file!)
  const bytes = await readFile(filePath)
  validateXlsxEnvelope({
    name: path.basename(filePath),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: bytes.length,
    buffer: bytes,
  })
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex")
  const sourceOfficial = checksumSha256 === PDTP_2026_PROGRAM_SOURCE.sha256
  if (!sourceOfficial && !options.allowCompatibleSource) {
    throw new Error(`El SHA-256 no coincide con la fuente oficial congelada del programa vigente (${PDTP_2026_PROGRAM_SOURCE.sha256}). Usa --allow-compatible-source sólo para una fixture controlada.`)
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  validateLoadedWorkbook(workbook)
  const catalog = extractPdtpCatalogFromWorkbook(workbook)
  return { filePath, bytes, checksumSha256, sourceOfficial, catalog, counts: assertReferenceCounts(catalog) }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.strategy === "rollback") {
    const [{ getUserRbacById }, service] = await Promise.all([
      import("../lib/auth/rbac"),
      import("../lib/services/prevention-pdtp"),
    ])
    const actor = await getUserRbacById(options.userId, true)
    if (!actor?.isActive) throw new Error("El usuario ejecutor no existe o está inactivo.")
    if (!actor.permissions.includes("prevention:pdtp:program:manage")) {
      throw new Error("El usuario ejecutor no tiene prevention:pdtp:program:manage.")
    }
    const imported = await service.getPdtpImportBatch(options.batchId!)
    if (!imported) throw new Error("El lote indicado no existe.")
    const program = await service.getPdtpProgram(imported.batch.programId)
    if (!program || program.year !== options.year) throw new Error("El lote no pertenece a un programa del año indicado.")
    const scope = actor.isGlobal ? "all" as const : actor.worksiteIds
    const result = await service.rollbackPdtpImportBatch({
      batchId: imported.batch.id,
      userId: actor.id,
      reason: options.reason!,
      scope,
    })
    console.log(JSON.stringify({ ok: true, strategy: "rollback", batchId: imported.batch.id, programId: program.id, result }, null, 2))
    return
  }
  const inspected = await inspectSource(options)
  const base = {
    ok: true,
    strategy: options.strategy,
    source: {
      file: inspected.filePath,
      sizeBytes: inspected.bytes.length,
      checksumSha256: inspected.checksumSha256,
      officialFrozenSource: inspected.sourceOfficial,
    },
    counts: inspected.counts,
    metadata: inspected.catalog.metadata,
    warnings: inspected.catalog.warnings ?? [],
  }
  if (options.strategy === "dry-run") {
    console.log(JSON.stringify({ ...base, mutatedDatabase: false }, null, 2))
    return
  }

  const [{ getUserRbacById }, service] = await Promise.all([
    import("../lib/auth/rbac"),
    import("../lib/services/prevention-pdtp"),
  ])
  const actor = await getUserRbacById(options.userId, true)
  if (!actor?.isActive) throw new Error("El usuario ejecutor no existe o está inactivo.")
  if (!actor.permissions.includes("prevention:pdtp:program:manage")) {
    throw new Error("El usuario ejecutor no tiene prevention:pdtp:program:manage.")
  }
  const program = await service.getPdtpProgram(options.programId!)
  if (!program) throw new Error("El programa destino no existe.")
  if (program.year !== options.year) throw new Error(`El programa destino corresponde a ${program.year}, no a ${options.year}.`)
  const scope = actor.isGlobal ? "all" as const : actor.worksiteIds
  if (options.worksiteId && scope !== "all" && !scope.includes(options.worksiteId)) {
    throw new Error("El usuario ejecutor no tiene alcance sobre la faena seleccionada.")
  }

  const staged = await service.stagePdtpXlsxImport({
    programId: program.id,
    bytes: inspected.bytes,
    fileName: path.basename(inspected.filePath),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    userId: actor.id,
  })
  if (options.strategy === "stage") {
    console.log(JSON.stringify({ ...base, mutatedDatabase: true, batchId: staged.batch.id, batchStatus: staged.batch.status, preview: staged.preview }, null, 2))
    return
  }

  const applied = await service.applyPdtpImportBatch({
    batchId: staged.batch.id,
    userId: actor.id,
    worksiteId: options.worksiteId,
    acceptMissingEvidence: options.acceptMissingEvidence,
    acceptanceReason: options.reason,
    scope,
  })
  // D10 (diseño 2026-08-12): las 10 definiciones de checklist se instalan en el
  // motor de inspecciones, no en el propio de PDTP. Son plantillas compartidas
  // entre programas, así que no entran en los artefactos de rollback del
  // arranque — a diferencia de los `pdtpActivityChecklists`, que sí eran del
  // programa y por eso se enumeraban en `checklistIdsCreated`.
  const checklists = await service.ensurePdtp2026InspectionTemplates({ actorUserId: actor.id })
  const activities = await service.listPdtpProgramActivities(program.id)
  const pendingClassifications = activities.filter((activity) => activity.scheduleClassificationStatus === "needs_review").length
  const template = options.publishReference
    ? await service.publishPdtpBase2026Revision({
        sourceProgramId: program.id,
        sourceChecksumSha256: inspected.checksumSha256,
        userId: actor.id,
        allowNonOfficialRevision: options.allowCompatibleSource,
      })
    : null
  const bootstrapArtifacts = await service.finalizePdtpImportBootstrap({
    batchId: staged.batch.id,
    userId: actor.id,
    checklistIdsCreated: [],
    templateIdCreated: template && !template.unchanged ? template.template.id : undefined,
    templateVersionIdCreated: template && !template.unchanged ? template.version.id : undefined,
  })
  console.log(JSON.stringify({
    ...base,
    mutatedDatabase: true,
    batchId: staged.batch.id,
    applied,
    checklists,
    bootstrapArtifacts,
    template: template ? {
      published: true,
      templateId: template.template.id,
      versionId: template.version.id,
      version: template.version.version,
      unchanged: template.unchanged,
      contentDigest: template.version.contentDigest,
    } : {
      published: false,
      requested: options.publishReference,
      pendingClassifications,
      reason: pendingClassifications > 0
        ? "Confirma la modalidad de todas las actividades sin P antes de publicar la referencia."
        : "Vuelve a ejecutar con --publish-reference para publicar explícitamente.",
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.error(usage())
  process.exitCode = 1
})
