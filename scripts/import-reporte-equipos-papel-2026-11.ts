/**
 * scripts/import-reporte-equipos-papel-2026-11.ts
 *
 * Carga los 30 «Reporte de Equipos» en papel de la faena Santa Fe del 2 al 9 de
 * noviembre de 2026 (PDF escaneado «Reportes de Equipos Noviembre 2026»), que
 * son anteriores a los programas diarios (desde el 14-11) y de los que salía a
 * mano el Excel de gestión del supervisor.
 *
 *   IMPORT_ACTOR_USER_ID=<id> IMPORT_DATA_DIR=<dir> npx tsx --env-file=.env.local scripts/import-reporte-equipos-papel-2026-11.ts
 *   … IMPORT_APPLY=true …   (sin esto sólo valida y muestra el plan)
 *
 * `IMPORT_DATA_DIR` tiene `reportes.json` y `paginas/pNN.jpg` (la transcripción
 * vive fuera del repo: trae nombres y firmas de trabajadores). En producción el
 * script se empaqueta con los datos embebidos y llama a `runImport` directo.
 *
 * **Es la misma operación que la UI, por otra puerta.** Cada reporte pasa por
 * `createInspectionRun` → foto del papel con `addRunDocument` → desviaciones sin
 * ítem con `registerDeviation` → `completeInspectionRun` con las respuestas y el
 * acta. Así los hallazgos, el cumplimiento, el historial, la acreditación PDTP y
 * el informe salen de las mismas reglas que una transcripción hecha a mano. Lo
 * único que no hace la UI es marcar `ingestion_source = 'legacy_document_import'`.
 *
 * Exige la v03 de la plantilla (`closingAct.allowMissingSignatures`): 8 de los
 * 30 papeles no traen alguna de las tres firmas y 9 vienen sin horómetro de
 * término. Con la v02 habría que inventarlos para poder cerrar.
 *
 * Al final consolida como pidió el usuario («una abierta por falla»): de cada
 * ítem en falla de un equipo queda abierto sólo el último reporte que lo trae;
 * los anteriores se cierran con motivo, y también los que un reporte posterior
 * marca normal. Los reportes que quedan sin hallazgos que exijan CAPA se dan por
 * revisados. Lo que sí exige CAPA (frenos, neumáticos, luces…) queda en la cola
 * de revisión, que es donde la plataforma lo deriva a una OT.
 *
 * Idempotente: `clientSubmissionId = papel-reporte-equipos-<folio|pág>`.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelVehicles,
  notifications,
  permissions as permissionsTable,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionRunDocuments,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
  worksites,
} from "@/db/schema"
import {
  addRunDocument,
  closeInspectionFinding,
  completeInspectionRun,
  createInspectionRun,
  registerDeviation,
  transitionInspectionRun,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"
import { createInspectionEvidencePath, resolveInspectionEvidenceDir, resolveStorageFile } from "@/lib/storage/config"
import { requiresCapa } from "@/lib/prevention/inspections"

export const TEMPLATE_CODE = "reporte_equipos"
export const WORKSITE_NAME = "Santa Fe"

/** Los 19 ítems de «Estado del camión / maquinaria»: los únicos que el papel marca en estas grúas y camiones. */
export const ESTADO_ITEMS = [
  "luces", "baliza", "bocina", "alarma_retroceso", "fuga_aceite_frenos", "espejos", "cinturon_seguridad",
  "freno_servicio", "freno_estacionamiento", "estado_carroceria", "neumaticos_llantas", "nivel_agua",
  "nivel_aceite_motor", "nivel_aceite_hidraulico", "extintor", "tableros_instrumentos", "direccion",
  "estado_asiento", "pernos_tuercas_rueda",
] as const

export type PaperReport = {
  pagina: number
  folio: string | null
  fecha: string
  fechaPapel: string
  equipo: string
  faenaPapel: string
  operador: string
  area: string | null
  turnoPapel: string | null
  turno: "dia" | null
  hInicio: string | null
  hTermino: string | null
  obs: string
  combustible: string | null
  lavado1: string | null
  fallas: { item: string; origen: "marca" | "observacion"; nota: string | null }[]
  sinLectura: "todos" | null
  desviaciones: { descripcion: string; danoPotencial: "leve" | "moderado" | "grave" | "fatal" }[]
  firmas: { entrante: boolean; saliente: boolean; supervisor: boolean }
  cierre: "operativo" | "operativo_con_observaciones" | "fuera_de_servicio"
  notas: string[]
  imagen: { archivo: string; bytes: number; sha256: string }
}

type AnswerRow = { sectionId: string; itemId: string; result: "conforming" | "non_conforming" | "not_applicable" | "recorded"; value?: string | null; comment?: string | null }

export function submissionId(report: PaperReport): string {
  return `papel-reporte-equipos-${report.folio ?? `pag-${report.pagina}`}`
}

const SIGNATURE_WITHOUT_NAME = "Firma sin nombre en el papel"

/** Respuestas del run a partir de la transcripción. Pura: es lo que decide qué dice el reporte. */
export function buildAnswers(report: PaperReport): AnswerRow[] {
  const rows: AnswerRow[] = []
  const recorded = (sectionId: string, itemId: string, value: string | null | undefined) => {
    if (value && value.trim()) rows.push({ sectionId, itemId, result: "recorded", value: value.trim() })
  }
  recorded("identificacion", "turno", report.turno)
  recorded("identificacion", "area_trabajo", report.area)
  recorded("identificacion", "operador_entrante", report.operador)
  recorded("identificacion", "folio_papel", report.folio ?? "S/N (encabezado cortado en el escaneo)")
  recorded("horometro", "horometro_inicio", report.hInicio)
  recorded("horometro", "horometro_termino", report.hTermino)
  recorded("control_mantencion", "carga_combustible", report.combustible)
  recorded("control_mantencion", "lavado_hora_1", report.lavado1)

  const fallas = new Map(report.fallas.map((falla) => [falla.item, falla]))
  for (const item of ESTADO_ITEMS) {
    const falla = fallas.get(item)
    if (falla) {
      rows.push({
        sectionId: "estado_camion", itemId: item, result: "non_conforming",
        comment: falla.origen === "marca"
          ? `Marcado en falla en el papel.${falla.nota ? ` ${falla.nota}.` : ""}`
          : `En la lista venía marcado normal o sin marca; las observaciones del papel dicen: «${falla.nota ?? report.obs}».`,
      })
    } else if (report.sinLectura === "todos") {
      rows.push({
        sectionId: "estado_camion", itemId: item, result: "not_applicable",
        comment: "Equipo fuera de servicio: el papel trae una línea sobre las columnas «Normal» y «Falla» y no se puede leer el estado.",
      })
    } else {
      rows.push({ sectionId: "estado_camion", itemId: item, result: "conforming" })
    }
  }
  recorded("observaciones", "observaciones", report.obs)
  return rows
}

export function buildSignatures(report: PaperReport) {
  const signatures: { role: string; name: string }[] = []
  if (report.firmas.entrante) signatures.push({ role: "operador_entrante", name: report.operador })
  if (report.firmas.saliente) signatures.push({ role: "operador_saliente", name: report.operador })
  if (report.firmas.supervisor) signatures.push({ role: "supervisor_turno", name: SIGNATURE_WITHOUT_NAME })
  return signatures
}

export function documentCaption(report: PaperReport): string {
  const head = `Reporte en papel N° ${report.folio ?? "S/N"} del ${report.fechaPapel} (página ${report.pagina} del PDF «Reportes de Equipos Noviembre 2026»).`
  return report.notas.length ? `${head} Notas de transcripción: ${report.notas.join(" ")}` : head
}

/**
 * Cómo se consolida cada hallazgo derivado. Pura y exportada para poder probarla sin base.
 *
 * Una falla que exige CAPA (grave o fatal: frenos, alarma de retroceso, luces…)
 * no se da por resuelta porque un papel posterior la marque normal: eso lo
 * verifica la CAPA y su OT, no un visto en la lista. Sólo se cierra si vuelve a
 * fallar más adelante (se sigue en el hallazgo más nuevo). Las leves y
 * moderadas sí se cierran con el primer reporte posterior que las marque normal.
 */
export type FindingState = { findingId: string; vehicleId: string; itemId: string; date: string; folio: string; capaRequired: boolean }
export type ItemAnswer = { vehicleId: string; itemId: string; date: string; folio: string; result: string }
export function consolidate(open: FindingState[], answers: ItemAnswer[]): { findingId: string; reason: string }[] {
  const closes: { findingId: string; reason: string }[] = []
  for (const finding of open) {
    const later = answers
      .filter((answer) => answer.vehicleId === finding.vehicleId && answer.itemId === finding.itemId && answer.date > finding.date)
      .sort((a, b) => a.date.localeCompare(b.date))
    const next = finding.capaRequired
      ? later.find((answer) => answer.result === "non_conforming")
      : later.find((answer) => answer.result === "conforming" || answer.result === "non_conforming")
    if (!next) continue
    const when = next.date.split("-").reverse().slice(0, 2).join("-")
    closes.push({
      findingId: finding.findingId,
      reason: next.result === "conforming"
        ? `Carga del papel: el reporte N° ${next.folio} del ${when} marca este ítem normal.`
        : `Carga del papel: el ítem vuelve a fallar en el reporte N° ${next.folio} del ${when}; se sigue en ese hallazgo.`,
    })
  }
  return closes
}

/** Los permisos reales del actor (roles + grants directos): se leen, no se declaran. */
export async function resolvePermissions(userId: string): Promise<string[]> {
  const fromRoles = await db.select({ name: permissionsTable.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId))
  const direct = await db.select({ name: permissionsTable.name })
    .from(userPermissions)
    .innerJoin(permissionsTable, eq(permissionsTable.id, userPermissions.permissionId))
    .where(eq(userPermissions.userId, userId))
  return [...new Set([...fromRoles, ...direct].map((row) => row.name))].sort()
}

const NEEDED = [
  "prevention:inspections:execute",
  "prevention:inspections:ingest",
  "prevention:inspections:review",
]

export async function runImport(options: {
  reports: PaperReport[]
  readImage: (file: string) => Buffer
  actorUserId: string
  apply: boolean
  log?: (line: string) => void
}) {
  const log = options.log ?? ((line: string) => console.log(line))
  const [actor] = await db.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users)
    .where(eq(users.id, options.actorUserId)).limit(1)
  if (!actor?.isActive) throw new Error(`El usuario ${options.actorUserId} no existe o está inactivo.`)
  const permissions = await resolvePermissions(actor.id)
  const missing = NEEDED.filter((permission) => !permissions.includes(permission))
  if (missing.length) throw new Error(`El actor no tiene ${missing.join(", ")}: el script no se concede permisos.`)
  const access: InspectionAccess = { userId: actor.id, scope: { mode: "all", ids: [] }, permissions }

  const [worksite] = await db.select({ id: worksites.id }).from(worksites).where(eq(worksites.name, WORKSITE_NAME)).limit(1)
  if (!worksite) throw new Error(`No existe la faena ${WORKSITE_NAME}.`)
  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(and(eq(preventionInspectionTemplates.sourceDefinitionCode, TEMPLATE_CODE), eq(preventionInspectionTemplates.status, "approved")))
    .limit(1)
  if (!template) throw new Error("No hay una plantilla reporte_equipos aprobada.")
  const snapshot = template.definitionSnapshot as { version?: string; closingAct?: { allowMissingSignatures?: boolean } }
  if (!snapshot.closingAct?.allowMissingSignatures) {
    throw new Error(`La plantilla aprobada es la v${snapshot.version ?? "?"}: falta aprobar la v03 (admite papeles sin alguna firma).`)
  }

  const codes = [...new Set(options.reports.map((report) => report.equipo))]
  const vehicles = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, worksiteId: fuelVehicles.worksiteId })
    .from(fuelVehicles).where(inArray(fuelVehicles.code, codes))
  const vehicleByCode = new Map(vehicles.map((vehicle) => [vehicle.code, vehicle]))
  const absent = codes.filter((code) => !vehicleByCode.has(code))
  if (absent.length) throw new Error(`Equipos que no están en la flota: ${absent.join(", ")}.`)

  const existing = await db.select({
    id: preventionInspectionRuns.id, clientSubmissionId: preventionInspectionRuns.clientSubmissionId, status: preventionInspectionRuns.status,
  })
    .from(preventionInspectionRuns)
    .where(inArray(preventionInspectionRuns.clientSubmissionId, options.reports.map(submissionId)))
  // Un reporte que quedó a medias (creado pero sin declarar ejecutado) se retoma, no se salta.
  const done = new Set(existing.filter((row) => row.status === "completed" || row.status === "reviewed").map((row) => row.clientSubmissionId))
  const halfway = new Map(existing.filter((row) => !done.has(row.clientSubmissionId)).map((row) => [row.clientSubmissionId, row]))
  const cancelled = existing.filter((row) => row.status === "cancelled")
  if (cancelled.length) throw new Error(`Hay reportes de esta carga cancelados (${cancelled.map((row) => row.clientSubmissionId).join(", ")}): revísalos a mano.`)

  log(`Plantilla ${template.name} v${snapshot.version} (${template.id}) · faena ${WORKSITE_NAME} · actor ${actor.name}`)
  log(`${options.reports.length} reportes; ya cargados ${done.size}; a medias ${halfway.size}; ${options.apply ? "APLICANDO" : "SIMULACIÓN (IMPORT_APPLY=true para escribir)"}`)

  const importedRunIds: string[] = []
  for (const report of [...options.reports].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.pagina - b.pagina)) {
    const vehicle = vehicleByCode.get(report.equipo)!
    const answers = buildAnswers(report)
    const label = `${report.fecha} ${report.equipo.padEnd(7)} N° ${(report.folio ?? "S/N").padEnd(6)}`
    const fallas = report.fallas.map((falla) => falla.item).join(", ") || "sin fallas"
    if (done.has(submissionId(report))) {
      log(`  = ${label} ya estaba cargado`)
      continue
    }
    if (vehicle.worksiteId !== worksite.id) log(`  ! ${label} el equipo no está hoy en ${WORKSITE_NAME}; se carga igual a esa faena`)
    log(`  + ${label} ${answers.length} respuestas · ${fallas} · firmas ${buildSignatures(report).length}/3 · ${report.cierre}${report.desviaciones.length ? ` · ${report.desviaciones.length} desviación(es)` : ""}`)
    if (!options.apply) continue

    const image = options.readImage(report.imagen.archivo)
    const checksum = createHash("sha256").update(image).digest("hex")
    if (checksum !== report.imagen.sha256) throw new Error(`La imagen ${report.imagen.archivo} no coincide con la transcripción.`)

    const resumed = halfway.get(submissionId(report))
    const run = resumed ?? (await createInspectionRun({
      templateId: template.id,
      worksiteId: worksite.id,
      subjectVehicleId: vehicle.id,
      origin: "prevencion",
      scheduledFor: report.fecha,
      clientSubmissionId: submissionId(report),
    }, access)).run
    const [attached] = resumed
      ? await db.select({ id: preventionInspectionRunDocuments.id }).from(preventionInspectionRunDocuments)
        .where(eq(preventionInspectionRunDocuments.runId, run.id)).limit(1)
      : []
    const registered = resumed
      ? await db.select({ description: preventionInspectionFindings.description }).from(preventionInspectionFindings)
        .where(and(eq(preventionInspectionFindings.runId, run.id), eq(preventionInspectionFindings.origin, "manual")))
      : []

    if (!attached) {
      const storageName = generateStorageName(`reporte-equipos-${report.folio ?? `pag-${report.pagina}`}.jpg`)
      const dir = resolveInspectionEvidenceDir()
      await mkdirp(dir)
      await writeBuffer(resolveStorageFile(dir, storageName), image)
      await addRunDocument({
        runId: run.id,
        path: createInspectionEvidencePath(storageName),
        fileName: `Reporte de equipos ${report.folio ?? `pagina ${report.pagina}`}.jpg`,
        mimeType: "image/jpeg",
        fileSize: image.length,
        checksumSha256: checksum,
        caption: documentCaption(report),
        kind: "source_form",
      }, access)
    }

    const already = new Set(registered.map((row) => row.description))
    for (const deviation of report.desviaciones) {
      if (already.has(deviation.descripcion)) continue
      await registerDeviation({ runId: run.id, description: deviation.descripcion, danoPotencial: deviation.danoPotencial }, access)
    }

    const [current] = await db.select({ version: preventionInspectionRuns.version }).from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, run.id)).limit(1)
    await completeInspectionRun({
      runId: run.id,
      expectedVersion: current!.version,
      answers,
      closingAct: { result: report.cierre, restrictions: null, signatures: buildSignatures(report) },
    }, access)
    await db.update(preventionInspectionRuns).set({ ingestionSource: "legacy_document_import" })
      .where(eq(preventionInspectionRuns.id, run.id))
    importedRunIds.push(run.id)
  }

  if (!options.apply) return { imported: 0, closed: 0, reviewed: 0, notificationsRead: 0, sundaysCancelled: 0 }

  // Consolidación: todo lo cargado de estos equipos, más los reportes que haya hoy en la plataforma.
  const vehicleIds = vehicles.map((vehicle) => vehicle.id)
  const runs = await db.select({
    id: preventionInspectionRuns.id, vehicleId: preventionInspectionRuns.subjectVehicleId,
    scheduledFor: preventionInspectionRuns.scheduledFor, status: preventionInspectionRuns.status,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .where(and(
      eq(preventionInspectionTemplates.sourceDefinitionCode, TEMPLATE_CODE),
      inArray(preventionInspectionRuns.subjectVehicleId, vehicleIds),
      inArray(preventionInspectionRuns.status, ["completed", "reviewed"]),
    ))
  const runById = new Map(runs.map((run) => [run.id, run]))
  const runIds = runs.map((run) => run.id)
  const folioRows = runIds.length ? await db.select({ runId: preventionInspectionAnswers.runId, value: preventionInspectionAnswers.value })
    .from(preventionInspectionAnswers)
    .where(and(inArray(preventionInspectionAnswers.runId, runIds), eq(preventionInspectionAnswers.itemId, "folio_papel"))) : []
  const folioOf = new Map(folioRows.map((row) => [row.runId, (row.value ?? "S/N").split(" ")[0]!]))
  const answerRows = runIds.length ? await db.select({
    id: preventionInspectionAnswers.id, runId: preventionInspectionAnswers.runId,
    itemId: preventionInspectionAnswers.itemId, result: preventionInspectionAnswers.result,
  }).from(preventionInspectionAnswers)
    .where(and(inArray(preventionInspectionAnswers.runId, runIds), eq(preventionInspectionAnswers.sectionId, "estado_camion"))) : []
  const answers: ItemAnswer[] = answerRows.map((row) => {
    const run = runById.get(row.runId)!
    return { vehicleId: run.vehicleId!, itemId: row.itemId, date: run.scheduledFor ?? "", folio: folioOf.get(row.runId) ?? "S/N", result: row.result }
  })
  const itemOfAnswer = new Map(answerRows.map((row) => [row.id, row.itemId]))
  const openFindings = runIds.length ? await db.select({
    id: preventionInspectionFindings.id, runId: preventionInspectionFindings.runId, answerId: preventionInspectionFindings.answerId,
    criticality: preventionInspectionFindings.criticality,
  }).from(preventionInspectionFindings)
    .where(and(
      inArray(preventionInspectionFindings.runId, runIds),
      eq(preventionInspectionFindings.status, "open"),
      eq(preventionInspectionFindings.origin, "derived"),
    ))
    .orderBy(asc(preventionInspectionFindings.createdAt)) : []
  const states: FindingState[] = openFindings.flatMap((finding) => {
    const run = runById.get(finding.runId)!
    const itemId = finding.answerId ? itemOfAnswer.get(finding.answerId) : undefined
    return itemId ? [{
      findingId: finding.id, vehicleId: run.vehicleId!, itemId, date: run.scheduledFor ?? "",
      folio: folioOf.get(finding.runId) ?? "S/N", capaRequired: requiresCapa(finding.criticality),
    }] : []
  })
  const closes = consolidate(states, answers)
  for (const close of closes) await closeInspectionFinding({ findingId: close.findingId, reason: close.reason }, access)
  log(`Consolidación: ${closes.length} hallazgo(s) cerrados por repetirse o normalizarse en un reporte posterior.`)

  let reviewed = 0
  const stillCompleted = await db.select({ id: preventionInspectionRuns.id, version: preventionInspectionRuns.version })
    .from(preventionInspectionRuns)
    .where(and(inArray(preventionInspectionRuns.id, importedRunIds), eq(preventionInspectionRuns.status, "completed")))
  for (const run of stillCompleted) {
    const pending = await db.select({ criticality: preventionInspectionFindings.criticality, capaActionId: preventionInspectionFindings.capaActionId })
      .from(preventionInspectionFindings)
      .where(and(eq(preventionInspectionFindings.runId, run.id), eq(preventionInspectionFindings.status, "open")))
    if (pending.some((finding) => requiresCapa(finding.criticality) && !finding.capaActionId)) continue
    await transitionInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "reviewed",
      reason: "Carga del papel: sus fallas se siguen en reportes posteriores o un reporte posterior las marca normales.",
    }, access)
    reviewed++
  }
  log(`Revisados al consolidar: ${reviewed}. Quedan esperando CAPA: ${stillCompleted.length - reviewed}.`)

  /* Los avisos «pendiente de revisión» de los reportes que esta misma carga
   * dejó revisados ya no esperan a nadie: se marcan leídos para no dejar en la
   * campana una cola que no existe. Los de los que siguen esperando CAPA quedan. */
  const nowReviewed = await db.select({ id: preventionInspectionRuns.id }).from(preventionInspectionRuns)
    .where(and(inArray(preventionInspectionRuns.id, importedRunIds), eq(preventionInspectionRuns.status, "reviewed")))
  const staleKeys = nowReviewed.map((run) => `inspection:review:${run.id}`)
  const read = staleKeys.length
    ? await db.update(notifications).set({ isRead: true })
      .where(and(inArray(notifications.dedupeKey, staleKeys), eq(notifications.isRead, false)))
      .returning({ id: notifications.id })
    : []
  log(`Avisos de revisión ya resueltos marcados como leídos: ${read.length}.`)

  // Lunes a sábado (v03): los reportes de domingo que el programa diario generó antes de la v03 no se esperan.
  const sundays = await db.select({ id: preventionInspectionRuns.id, version: preventionInspectionRuns.version, scheduledFor: preventionInspectionRuns.scheduledFor })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .where(and(
      eq(preventionInspectionTemplates.sourceDefinitionCode, TEMPLATE_CODE),
      eq(preventionInspectionRuns.worksiteId, worksite.id),
      eq(preventionInspectionRuns.status, "planned"),
      sql`extract(isodow from ${preventionInspectionRuns.scheduledFor}::date) = 7`,
    ))
  for (const run of sundays) {
    await transitionInspectionRun({
      runId: run.id, expectedVersion: run.version, toStatus: "cancelled",
      reason: `Domingo ${run.scheduledFor}: desde la v03 el Reporte de Equipos se programa de lunes a sábado.`,
    }, access)
  }
  log(`Reportes de domingo cancelados: ${sundays.length}.`)
  return { imported: importedRunIds.length, closed: closes.length, reviewed, notificationsRead: read.length, sundaysCancelled: sundays.length }
}

async function main() {
  const actorUserId = process.env.IMPORT_ACTOR_USER_ID?.trim()
  const dataDir = process.env.IMPORT_DATA_DIR?.trim()
  if (!actorUserId || !dataDir) throw new Error("Faltan IMPORT_ACTOR_USER_ID e IMPORT_DATA_DIR.")
  const reports = JSON.parse(readFileSync(path.join(dataDir, "reportes.json"), "utf8")) as PaperReport[]
  const result = await runImport({
    reports,
    readImage: (file) => readFileSync(path.join(dataDir, "paginas", file)),
    actorUserId,
    apply: process.env.IMPORT_APPLY === "true",
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1]?.endsWith("import-reporte-equipos-papel-2026-11.ts")) {
  main().then(() => process.exit(0), (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
