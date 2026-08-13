/**
 * Bootstrap de Base Preventiva 2026 para producción.
 *
 * Invoca el adaptador dedicado (bootstrap-pdtp-2026.ts) después de
 * asegurar que el programa PDTP 2026 existe en la base de datos.
 *
 * Uso en producción (desde el directorio docker-compose):
 *   docker compose run --rm bootstrap-pdtp
 *
 * Variables de entorno requeridas:
 *   BOOTSTRAP_XLSX_PATH    — ruta al XLSX dentro del contenedor
 *   BOOTSTRAP_USER_ID      — UUID del usuario que ejecuta (admin global)
 *   PUBLISH_REFERENCE=true — publica la revisión inmutable (Base 2026)
 *
 * Ejemplo:
 *   BOOTSTRAP_XLSX_PATH=/app/PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx \
 *   BOOTSTRAP_USER_ID=<uuid> \
 *   PUBLISH_REFERENCE=true \
 *   docker compose run --rm bootstrap-pdtp
 */

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { db } from "@/db"
import { pdtpPrograms, users as schemaUsers } from "@/db/schema"
import { pdtpProgramId } from "@/lib/services/pdtp/helpers"
import { eq } from "drizzle-orm"
import { getCurrentPdtpBase2026Version } from "@/lib/services/pdtp/templates"

const PDTP_BASE_2026_XLSX = process.env.BOOTSTRAP_XLSX_PATH ?? "/app/PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx"
const BOOTSTRAP_USER_ID = process.env.BOOTSTRAP_USER_ID
const PUBLISH_REFERENCE = process.env.PUBLISH_REFERENCE === "true"

type BootstrapResult = {
  ok: boolean
  step: string
  error?: string
  programId?: string
  batchId?: string
  templateId?: string
  templateVersionId?: string
  templateVersion?: number
  contentDigest?: string
  unchanged?: boolean
  pendingClassifications?: number
  /** Resultado crudo del apply del lote: la evidencia de qué se insertó. */
  applyResult?: Record<string, unknown>
}

function fail(step: string, error: unknown): BootstrapResult {
  return {
    ok: false,
    step,
    error: error instanceof Error ? error.message : String(error),
  }
}

async function getOrCreateProgram2026(): Promise<{ programId: string; created: boolean }> {
  const [existing] = await db
    .select({ id: pdtpPrograms.id })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, 2026))
    .limit(1)

  if (existing) {
    return { programId: existing.id, created: false }
  }

  // Verify user exists and has permission
  if (!BOOTSTRAP_USER_ID) {
    throw new Error("BOOTSTRAP_USER_ID no está definido. Configúralo antes de ejecutar el bootstrap.")
  }

  const [actor] = await db
    .select({ id: schemaUsers.id, name: schemaUsers.name })
    .from(schemaUsers)
    .where(eq(schemaUsers.id, BOOTSTRAP_USER_ID))
    .limit(1)

  if (!actor) {
    throw new Error(`El usuario ${BOOTSTRAP_USER_ID} no existe en la base de datos.`)
  }

  const now = new Date().toISOString()
  const programId = pdtpProgramId(2026, 1)
  const elaboratedByName = actor.name?.trim() || "Equipo de Prevención"

  await db.insert(pdtpPrograms).values({
    id: programId,
    year: 2026,
    version: 1,
    status: "draft",
    title: "Programa de Trabajo Preventivo SG-SST 2026",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    creationMode: "base_2026",
    sourceProgramId: null,
    sourceContentVersion: null,
    sourceTemplateVersionId: null,
    elaboratedByUserId: BOOTSTRAP_USER_ID,
    elaboratedByName,
    elaboratedByTitle: "Sistema",
    createdAt: now,
    updatedAt: now,
  })

  return { programId, created: true }
}

async function bootstrapBase2026(programId: string): Promise<BootstrapResult> {
  const filePath = path.resolve(process.cwd(), PDTP_BASE_2026_XLSX)
  let bytes: Buffer

  try {
    bytes = await readFile(filePath)
  } catch {
    return fail("read", `No se pudo leer ${filePath}. Asegúrate de que el XLSX esté montado en el contenedor.`)
  }

  const checksumSha256 = createHash("sha256").update(bytes).digest("hex")

  // Validate XLSX structure
  let workbook: ExcelJS.Workbook
  try {
    workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as never)
  } catch (e) {
    return fail("parse-xlsx", e)
  }

  // Dynamic imports: only load the full bootstrap chain when needed
  const [
    { PDTP_2026_INVARIANTS, PDTP_2026_PROGRAM_SOURCE },
    { extractPdtpCatalogFromWorkbook },
    { validateLoadedPdtpWorkbook, validatePdtpXlsxEnvelope },
    { getUserRbacById },
    service,
  ] = await Promise.all([
    import("../lib/services/pdtp-adapters/contract-2026"),
    import("../lib/services/prevention-pdtp-catalog"),
    import("../lib/services/pdtp/xlsx-security"),
    import("../lib/auth/rbac"),
    import("../lib/services/prevention-pdtp"),
  ])

  // Validate XLSX envelope
  try {
    validatePdtpXlsxEnvelope({
      name: path.basename(filePath),
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: bytes.length,
      buffer: bytes,
    })
  } catch (e) {
    return fail("validate-xlsx", e)
  }

  const sourceOfficial = checksumSha256 === PDTP_2026_PROGRAM_SOURCE.sha256
  if (!sourceOfficial) {
    return fail("checksum", `SHA-256 del XLSX (${checksumSha256}) no coincide con la fuente oficial congelada (${PDTP_2026_PROGRAM_SOURCE.sha256}).`)
  }

  // Validate workbook structure
  try {
    validateLoadedPdtpWorkbook(workbook)
  } catch (e) {
    return fail("validate-workbook", e)
  }

  const catalog = extractPdtpCatalogFromWorkbook(workbook)

  // Validate reference counts
  const schedule = catalog.activities.flatMap((a) => a.schedule)
  const executions = catalog.importedExecutions ?? []
  const actual = {
    activities: catalog.activities.length,
    views: Object.keys(catalog.sheetActivities).length,
    plannedCells: schedule.length,
    plannedQuantity: schedule.reduce((sum, c) => sum + c.plannedQuantity, 0),
    executedCells: executions.length,
    executedQuantity: executions.reduce((sum, c) => sum + c.executedQuantity, 0),
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
    return fail("contract", `El XLSX no cumple el contrato 2026. Esperado ${JSON.stringify(expected)}; recibido ${JSON.stringify(actual)}.`)
  }

  // Verify user permissions
  if (!BOOTSTRAP_USER_ID) return fail("auth", "BOOTSTRAP_USER_ID no está definido.")
  const actor = await getUserRbacById(BOOTSTRAP_USER_ID, true)
  if (!actor?.isActive) return fail("auth", "El usuario ejecutor no existe o está inactivo.")
  if (!actor.permissions.includes("prevention:pdtp:program:manage")) {
    return fail("auth", "El usuario ejecutor no tiene prevention:pdtp:program:manage.")
  }
  if (!actor.isGlobal) return fail("auth", "El usuario ejecutor debe ser global (administrador).")

  // Stage the XLSX import
  let staged: Awaited<ReturnType<typeof service.stagePdtpXlsxImport>>
  try {
    staged = await service.stagePdtpXlsxImport({
      programId,
      bytes,
      fileName: path.basename(filePath),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: BOOTSTRAP_USER_ID,
    })
  } catch (e) {
    return fail("stage", e)
  }

  // Apply the import batch
  let applied: Awaited<ReturnType<typeof service.applyPdtpImportBatch>>
  try {
    applied = await service.applyPdtpImportBatch({
      batchId: staged.batch.id,
      userId: BOOTSTRAP_USER_ID,
      scope: "all",
    })
  } catch (e) {
    return fail("apply", e)
  }

  // Ensure checklist templates (D10: viven en el motor de inspecciones)
  try {
    await service.ensurePdtp2026InspectionTemplates({ actorUserId: BOOTSTRAP_USER_ID })
  } catch (e) {
    return fail("checklists", e)
  }

  // Publish the reference template if requested
  let template: Awaited<ReturnType<typeof service.publishPdtpBase2026Revision>> | null = null
  if (PUBLISH_REFERENCE) {
    try {
      template = await service.publishPdtpBase2026Revision({
        sourceProgramId: programId,
        sourceChecksumSha256: checksumSha256,
        userId: BOOTSTRAP_USER_ID,
      })
    } catch (e) {
      return fail("publish-reference", e)
    }
  }

  // Finalize
  try {
    await service.finalizePdtpImportBootstrap({
      batchId: staged.batch.id,
      userId: BOOTSTRAP_USER_ID,
      checklistIdsCreated: [],
      templateIdCreated: template && !template.unchanged ? template.template.id : undefined,
      templateVersionIdCreated: template && !template.unchanged ? template.version.id : undefined,
    })
  } catch (e) {
    return fail("finalize", e)
  }

  // Check pending classifications
  const activities = await service.listPdtpProgramActivities(programId)
  const pendingClassifications = activities.filter((a) => a.scheduleClassificationStatus === "needs_review").length

  return {
    ok: true,
    step: "complete",
    programId,
    batchId: staged.batch.id,
    templateId: template && !template.unchanged ? template.template.id : undefined,
    templateVersionId: template && !template.unchanged ? template.version.id : undefined,
    // El resultado del apply se estaba descartando: en un bootstrap que sólo
    // imprime JSON, es la única evidencia de qué se insertó realmente.
    applyResult: applied,
    templateVersion: template && !template.unchanged ? template.version.version : undefined,
    contentDigest: template && !template.unchanged ? template.version.contentDigest : undefined,
    unchanged: template?.unchanged,
    pendingClassifications: pendingClassifications > 0 ? pendingClassifications : undefined,
  }
}

async function main() {
  console.log("=== Bootstrap Base Preventiva 2026 ===\n")

  // Step 1: Create program if needed
  let program: { programId: string; created: boolean }
  try {
    program = await getOrCreateProgram2026()
  } catch (e) {
    console.error(JSON.stringify(fail("create-program", e), null, 2))
    process.exit(1)
  }

  console.log(program.created
    ? `Programa 2026 creado: ${program.programId}`
    : `Programa 2026 existente: ${program.programId}`)

  // Step 2: Check if base is already published
  const existingBase = await getCurrentPdtpBase2026Version()
  if (existingBase && !PUBLISH_REFERENCE) {
    console.log(`Base 2026 ya publicada (v${existingBase.version.version}). No se requiere acción adicional.`)
    console.log(JSON.stringify({
      ok: true,
      step: "already-published",
      templateId: existingBase.template.id,
      versionId: existingBase.version.id,
      version: existingBase.version.version,
      contentDigest: existingBase.version.contentDigest,
    }, null, 2))
    process.exit(0)
  }

  if (existingBase) {
    console.log(`Base 2026 ya publicada (v${existingBase.version.version}). Se ejecutará con PUBLISH_REFERENCE de todas formas.`)
  }

  // Step 3: Run bootstrap
  const result = await bootstrapBase2026(program.programId)
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }

  console.log("\n=== Bootstrap completado ===")
  if (PUBLISH_REFERENCE) {
    if (result.unchanged) {
      console.log("Base 2026: sin cambios (ya estaba actualizada).")
    } else {
      console.log(`Base 2026 publicada: v${result.templateVersion} (${result.contentDigest}).`)
    }
  } else {
    console.log("Datos importados. Usa PUBLISH_REFERENCE=true para publicar la referencia inmutable.")
  }

  if (result.pendingClassifications) {
    console.log(`⚠️  ${result.pendingClassifications} actividades sin modalidad confirmada.`)
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
