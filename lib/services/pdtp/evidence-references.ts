/**
 * Referencias a archivos de evidencia PDTP: quién es dueño de un archivo y
 * cuáles están referenciados.
 *
 * El directorio `storage/pdtp-evidence/` tiene varios productores —la planilla
 * (`pdtp_executions`), el plan de acción (`prevention_capa_evidence`) y las
 * instancias programadas (`pdtp_scheduled_instances.source_metadata_json`)—, y
 * el historial de envíos (`audit_log`, PREV-I04) guarda además las rutas de los
 * intentos anteriores. Antes cada consumidor armaba su propia lista: la
 * descarga sólo miraba ejecuciones (PREV-I05: la evidencia CAPA daba 404) y el
 * GC no miraba instancias. Este módulo es la fuente única (PREV-I13-C).
 */
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { auditLog, pdtpExecutions, pdtpScheduledInstances, preventionCapaActions, preventionCapaEvidence } from "@/db/schema"
import { capaEsDelPdtp } from "./capa-view"
import { PDTP_EVIDENCE_PATH_PREFIX } from "./evidence-href"
import { PDTP_EXECUTION_HISTORY_ENTITY, parsePdtpHistoryState, pdtpEvidenceSha256Map, pdtpHistoryEvidencePaths } from "./execution-history"
import type { WorksiteScope } from "./helpers"

export type PdtpEvidenceSource = "execution" | "capa" | "history" | "instance"

export type PdtpEvidenceReference = {
  path: string
  source: PdtpEvidenceSource
  /** Id de la fila que referencia: ejecución, evidencia CAPA, fila de bitácora o instancia. */
  ownerId: string
  worksiteId: string | null
  /** sha256 registrado al vincular el archivo, cuando se conoce. */
  sha256: string | null
}

export type PdtpEvidenceOwner = { worksiteId: string; source: Exclude<PdtpEvidenceSource, "history"> }

type WorksiteColumn = typeof pdtpExecutions.worksiteId | typeof preventionCapaActions.worksiteId | typeof pdtpScheduledInstances.worksiteId

function inScope(column: WorksiteColumn, scope: WorksiteScope): SQL | undefined {
  if (scope === "all") return undefined
  if (scope.length === 0) return sql`false`
  return inArray(column, scope)
}

/**
 * La faena dueña de un archivo del directorio PDTP, dentro del alcance del
 * usuario, o `null`.
 *
 * PREV-M02-A: la búsqueda es por igualdad exacta de la ruta. El `LIKE %name%`
 * anterior dejaba que un nombre contenido en otro "adoptara" su dueño. Las
 * fotos se comparan con contención jsonb (`@>`), que también es exacta.
 *
 * PREV-I05: además de las ejecuciones, autoriza la evidencia del plan de acción
 * del PDTP (sólo acciones con `source_type = 'pdtp'`: la CAPA de otro módulo se
 * sirve en ese módulo) y la de las instancias programadas.
 */
export async function findPdtpEvidenceOwner(name: string, scope: WorksiteScope): Promise<PdtpEvidenceOwner | null> {
  const path = `${PDTP_EVIDENCE_PATH_PREFIX}${name}`

  const [execution] = await db.select({ worksiteId: pdtpExecutions.worksiteId })
    .from(pdtpExecutions)
    .where(and(
      or(
        eq(pdtpExecutions.evidenceUrl, path),
        sql`${pdtpExecutions.evidencePhotos} @> ${JSON.stringify([path])}::jsonb`,
      ),
      inScope(pdtpExecutions.worksiteId, scope),
    ))
    .limit(1)
  if (execution) return { worksiteId: execution.worksiteId, source: "execution" }

  const [capa] = await db.select({ worksiteId: preventionCapaActions.worksiteId })
    .from(preventionCapaEvidence)
    .innerJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionCapaEvidence.actionId))
    .where(and(
      capaEsDelPdtp,
      eq(preventionCapaEvidence.reference, path),
      inScope(preventionCapaActions.worksiteId, scope),
    ))
    .limit(1)
  if (capa) return { worksiteId: capa.worksiteId, source: "capa" }

  const [instance] = await db.select({ worksiteId: pdtpScheduledInstances.worksiteId })
    .from(pdtpScheduledInstances)
    .where(and(
      sql`${pdtpScheduledInstances.sourceMetadataJson}->>'evidenceRef' = ${path}`,
      inScope(pdtpScheduledInstances.worksiteId, scope),
    ))
    .limit(1)
  if (instance) return { worksiteId: instance.worksiteId, source: "instance" }

  return null
}

/**
 * Todas las referencias a evidencia que la base conoce, de las cuatro fuentes.
 * Incluye rutas de otros directorios (integraciones) y textos: quien consume
 * decide qué le importa —el escaneo sólo mira el directorio PDTP; el GC
 * conserva cualquier nombre mencionado, que es el lado seguro—.
 */
export async function collectPdtpEvidenceReferences(): Promise<PdtpEvidenceReference[]> {
  const [executions, capaRows, instances, historyRows] = await Promise.all([
    db.select({
      id: pdtpExecutions.id,
      worksiteId: pdtpExecutions.worksiteId,
      evidenceUrl: pdtpExecutions.evidenceUrl,
      evidencePhotos: pdtpExecutions.evidencePhotos,
      sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
    }).from(pdtpExecutions),
    // Todas las CAPA, no sólo las del PDTP: si otro módulo guardó una ruta de
    // este directorio, el GC no debe borrarla. El escaneo filtra por ruta.
    db.select({
      id: preventionCapaEvidence.id,
      reference: preventionCapaEvidence.reference,
      checksumSha256: preventionCapaEvidence.checksumSha256,
      worksiteId: preventionCapaActions.worksiteId,
    })
      .from(preventionCapaEvidence)
      .innerJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionCapaEvidence.actionId)),
    db.select({
      id: pdtpScheduledInstances.id,
      worksiteId: pdtpScheduledInstances.worksiteId,
      evidenceRef: sql<string | null>`${pdtpScheduledInstances.sourceMetadataJson}->>'evidenceRef'`,
    })
      .from(pdtpScheduledInstances)
      .where(sql`${pdtpScheduledInstances.sourceMetadataJson}->>'evidenceRef' IS NOT NULL`),
    db.select({
      id: auditLog.id,
      worksiteId: auditLog.worksiteId,
      oldState: auditLog.oldState,
      newState: auditLog.newState,
    })
      .from(auditLog)
      .where(eq(auditLog.entityType, PDTP_EXECUTION_HISTORY_ENTITY)),
  ])

  const references: PdtpEvidenceReference[] = []

  for (const row of executions) {
    const sha = pdtpEvidenceSha256Map(row.sourceMetadataJson)
    const photos = Array.isArray(row.evidencePhotos) ? row.evidencePhotos : []
    const paths = [row.evidenceUrl, ...photos].filter((value): value is string => typeof value === "string" && value.length > 0)
    for (const path of new Set(paths)) {
      references.push({ path, source: "execution", ownerId: row.id, worksiteId: row.worksiteId, sha256: sha[path] ?? null })
    }
  }
  for (const row of capaRows) {
    if (!row.reference) continue
    references.push({ path: row.reference, source: "capa", ownerId: row.id, worksiteId: row.worksiteId, sha256: row.checksumSha256 ?? null })
  }
  for (const row of instances) {
    if (!row.evidenceRef) continue
    references.push({ path: row.evidenceRef, source: "instance", ownerId: row.id, worksiteId: row.worksiteId, sha256: null })
  }
  for (const row of historyRows) {
    const before = parsePdtpHistoryState(row.oldState)
    const after = parsePdtpHistoryState(row.newState)
    const sha = { ...pdtpEvidenceSha256Map(before), ...pdtpEvidenceSha256Map(after) }
    const paths = new Set([...pdtpHistoryEvidencePaths(before), ...pdtpHistoryEvidencePaths(after)])
    for (const path of paths) {
      references.push({ path, source: "history", ownerId: row.id, worksiteId: row.worksiteId, sha256: sha[path] ?? null })
    }
  }
  return references
}

export function isPdtpEvidencePath(path: string): boolean {
  return path.startsWith(PDTP_EVIDENCE_PATH_PREFIX)
}

/**
 * Faenas distintas de `worksiteId` cuyas filas ya referencian `path`, en las
 * cuatro fuentes (ejecuciones, CAPA, instancias e historial de envíos).
 */
async function foreignPdtpEvidenceWorksites(client: Tx | typeof db, path: string, worksiteId: string): Promise<Set<string>> {
  const quoted = JSON.stringify(path)
  const [executions, capaRows, instances, historyRows] = await Promise.all([
    client.select({ worksiteId: pdtpExecutions.worksiteId })
      .from(pdtpExecutions)
      .where(and(
        or(
          eq(pdtpExecutions.evidenceUrl, path),
          sql`${pdtpExecutions.evidencePhotos} @> ${JSON.stringify([path])}::jsonb`,
        ),
        ne(pdtpExecutions.worksiteId, worksiteId),
      )),
    client.select({ worksiteId: preventionCapaActions.worksiteId })
      .from(preventionCapaEvidence)
      .innerJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionCapaEvidence.actionId))
      .where(and(eq(preventionCapaEvidence.reference, path), ne(preventionCapaActions.worksiteId, worksiteId))),
    client.select({ worksiteId: pdtpScheduledInstances.worksiteId })
      .from(pdtpScheduledInstances)
      .where(and(
        sql`${pdtpScheduledInstances.sourceMetadataJson}->>'evidenceRef' = ${path}`,
        ne(pdtpScheduledInstances.worksiteId, worksiteId),
      )),
    // El historial guarda los estados como JSON en texto: se busca la ruta
    // entre comillas, que es como la serializa `recordModuleHistory`.
    client.select({ worksiteId: auditLog.worksiteId })
      .from(auditLog)
      .where(and(
        eq(auditLog.entityType, PDTP_EXECUTION_HISTORY_ENTITY),
        or(sql`strpos(${auditLog.oldState}, ${quoted}) > 0`, sql`strpos(${auditLog.newState}, ${quoted}) > 0`),
        sql`${auditLog.worksiteId} IS DISTINCT FROM ${worksiteId}`,
      )),
  ])
  const foreign = new Set<string>()
  for (const row of [...executions, ...capaRows, ...instances, ...historyRows]) {
    // Una fila de bitácora sin faena no dice de quién es: se trata como ajena.
    foreign.add(row.worksiteId ?? "")
  }
  return foreign
}

/**
 * Revisión final 2026-09-27 (toma de evidencia entre faenas): la descarga
 * autoriza por la fila que referencia el archivo (`findPdtpEvidenceOwner`), así
 * que vincular una ruta que ya es de otra faena equivalía a apropiarse del
 * archivo: quien opera la faena B escribía en su celda la ruta de un PDF de la
 * faena A y después lo descargaba como propio.
 *
 * Al vincular se exige que ninguna fila de **otra** faena referencie la ruta,
 * salvo que esa faena también esté en el alcance de quien vincula (ya podía
 * descargarlo). Volver a vincular un archivo propio —reenvío, fusión
 * append-only de la evidencia anterior— no cambia nada: sus filas son de la
 * misma faena. Un archivo recién subido todavía no tiene filas y pasa.
 *
 * Sólo mira el directorio PDTP: es el único que sirve la descarga PDTP.
 * Corre con el cliente de la transacción que escribe la referencia.
 */
export async function assertPdtpEvidenceLinkable(
  client: Tx | typeof db,
  input: { paths: ReadonlyArray<string | null | undefined>; worksiteId: string; scope: WorksiteScope },
): Promise<void> {
  const paths = [...new Set(input.paths.filter((path): path is string => typeof path === "string" && isPdtpEvidencePath(path)))]
  for (const path of paths) {
    const foreign = await foreignPdtpEvidenceWorksites(client, path, input.worksiteId)
    const outOfScope = [...foreign].filter((worksiteId) => input.scope !== "all" && (!worksiteId || !input.scope.includes(worksiteId)))
    if (outOfScope.length > 0) {
      const name = path.slice(PDTP_EVIDENCE_PATH_PREFIX.length)
      throw new Error(`El archivo de evidencia "${name}" ya está vinculado a otra faena y no se puede usar aquí. Sube el archivo desde esta faena.`)
    }
  }
}
