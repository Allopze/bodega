/**
 * Saneamiento de PRV-01 / PRV-03 (auditoría de production readiness 2026-09-28).
 *
 * Antes de la corrección, la acreditación automática aprobaba sola las
 * ejecuciones de alcotest, simulacros, CGRD, higiene y coordinación con el
 * mandante cuya "evidencia" sólo tenía la forma de una ruta `storage/…` o de
 * una URL, y el registro manual aceptaba semanas futuras. Este script lista lo
 * que quedó aprobado así y, con `--apply --actor=<userId>`, lo devuelve a
 * `submitted` para que una persona lo revise en Aprobaciones.
 *
 * Uso:
 *   npm run pdtp:report-unverified-approvals              # sólo reporta
 *   npm run pdtp:report-unverified-approvals -- --apply --actor=<userId>
 *
 * En el deploy (`scripts/deploy-prod.sh`, one-shot
 * `apply-pdtp-unverified-approvals`) corre con `PDTP_UNVERIFIED_DEPLOY_MODE`:
 *
 * - aplica, atribuyendo la corrección a `PDTP_UNVERIFIED_ACTOR_USER_ID` o, si
 *   falta, al primer usuario con rol `administrador` (mismo patrón que
 *   `apply-pdtp-2026-mechanisms.ts`);
 * - `PDTP_UNVERIFIED_DRY_RUN=true` lo deja en sólo reportar;
 * - un error se informa y no aborta el deploy: la corrección es idempotente
 *   (sólo toca filas `approved`) y el deploy siguiente la retoma.
 *
 * - Nunca borra nada: cambia el estado y deja la traza en el control de
 *   cambios del programa y en el historial de la ejecución.
 * - Un mes ya cerrado no se toca (su cifra está congelada en la foto del
 *   cierre): se reporta como "mes cerrado" para decidir caso a caso.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpExecutions, pdtpPrograms, roles, userRoles, users } from "@/db/schema"
import { addPdtpChangeLogEntry } from "@/lib/services/pdtp/helpers"
import { pdtpExecutionHistorySnapshot, recordPdtpExecutionHistory } from "@/lib/services/pdtp/execution-history"
import { verifyIntegrationEvidence } from "@/lib/services/pdtp/integration-evidence"
import { isPdtpCellInFuture } from "@/lib/services/pdtp/period"
import { assertPdtpPeriodOpen } from "@/lib/services/pdtp/period-guard"

const DEPLOY_MODE = process.env.PDTP_UNVERIFIED_DEPLOY_MODE === "true"
const apply = DEPLOY_MODE
  ? process.env.PDTP_UNVERIFIED_DRY_RUN !== "true"
  : process.argv.includes("--apply")
let actor = process.argv.find((arg) => arg.startsWith("--actor="))?.slice("--actor=".length)
  ?? (process.env.PDTP_UNVERIFIED_ACTOR_USER_ID?.trim() || undefined)
const VERIFIABLE = ["alcotest", "emergencia", "cgrd", "higiene", "engagement"] as const

type Finding = {
  executionId: string
  programId: string
  activityN: number
  worksiteId: string
  cell: string
  reason: string
}

/** En el deploy, sin actor explícito firma el primer administrador. */
async function resolveDeployActor(): Promise<string | undefined> {
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  return row?.userId
}

async function main() {
  if (apply && !actor && DEPLOY_MODE) {
    actor = await resolveDeployActor()
    if (!actor) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_UNVERIFIED_ACTOR_USER_ID.")
  }
  if (apply && !actor) throw new Error("--apply exige --actor=<userId> (quien firma la corrección).")
  if (apply) {
    const [actorRow] = await db.select({ id: users.id }).from(users).where(eq(users.id, actor!)).limit(1)
    if (!actorRow) throw new Error(`No existe el usuario ${actor}.`)
  }

  const approved = await db.select({
    execution: pdtpExecutions,
    activityN: pdtpActivities.n,
    programId: pdtpActivities.programId,
    programVersion: pdtpPrograms.version,
  })
    .from(pdtpExecutions)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutions.activityId))
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .where(and(eq(pdtpExecutions.status, "approved"), inArray(pdtpPrograms.status, ["active", "closed"])))

  const findings: Array<Finding & { row: (typeof approved)[number] }> = []
  for (const row of approved) {
    const execution = row.execution
    const cell = `${execution.year}-${String(execution.month).padStart(2, "0")} sem ${execution.week}`
    const metadata = (execution.sourceMetadataJson ?? {}) as Record<string, unknown>
    const base = { executionId: execution.id, programId: row.programId, activityN: row.activityN, worksiteId: execution.worksiteId, cell }

    if (isPdtpCellInFuture(execution)) {
      findings.push({ ...base, reason: "semana futura aprobada", row })
      continue
    }
    const sourceType = execution.sourceType as (typeof VERIFIABLE)[number] | null
    if (
      execution.origin === "integration"
      && metadata.approvalMode === "automatic_source_event"
      && sourceType && (VERIFIABLE as readonly string[]).includes(sourceType)
    ) {
      const check = await verifyIntegrationEvidence({
        ref: execution.evidenceUrl ?? execution.evidenceText,
        sourceType,
        worksiteId: execution.worksiteId,
      })
      if (!check.verified) findings.push({ ...base, reason: `auto-aprobada sin evidencia verificable (${check.reason})`, row })
    }
  }

  console.log(`[pdtp-unverified-approvals] modo: ${apply ? "apply" : "dry-run"} · aprobadas revisadas: ${approved.length} · hallazgos: ${findings.length}`)
  for (const finding of findings) {
    console.log(`  - ${finding.executionId} · N°${finding.activityN} · faena ${finding.worksiteId} · ${finding.cell} · ${finding.reason}`)
  }
  if (!apply || findings.length === 0) return

  let reverted = 0
  let closed = 0
  for (const finding of findings) {
    const { execution } = finding.row
    try {
      await assertPdtpPeriodOpen(finding.programId, execution.worksiteId, execution.year, execution.month)
    } catch {
      closed++
      console.log(`  · ${finding.executionId}: mes cerrado, no se modifica`)
      continue
    }
    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(pdtpExecutions).set({
        status: "submitted",
        approvedByUserId: null,
        approvedAt: null,
        evidenceStatus: execution.evidenceStatus === "provided" ? "pending" : execution.evidenceStatus,
        sourceMetadataJson: {
          ...((execution.sourceMetadataJson ?? {}) as Record<string, unknown>),
          unverifiedApprovalReverted: { at: now, actorUserId: actor, reason: finding.reason },
        },
        updatedAt: now,
      }).where(and(eq(pdtpExecutions.id, execution.id), eq(pdtpExecutions.status, "approved"))).returning()
      if (!updated) return
      await recordPdtpExecutionHistory(tx, {
        executionId: updated.id,
        worksiteId: updated.worksiteId,
        changeType: "revoked",
        actorUserId: actor!,
        before: pdtpExecutionHistorySnapshot(execution),
        after: pdtpExecutionHistorySnapshot(updated),
      })
      await addPdtpChangeLogEntry(
        finding.programId, finding.row.programVersion, actor!, `execution:${updated.id}`,
        { status: "approved" }, { status: "submitted" },
        `PRV-01/PRV-03: aprobación de la N°${finding.activityN} (${finding.cell}) devuelta a revisión: ${finding.reason}.`,
        tx,
      )
      reverted++
    })
  }
  console.log(`[pdtp-unverified-approvals] devueltas a revisión: ${reverted} · en meses cerrados (sin cambios): ${closed}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  if (DEPLOY_MODE) {
    console.error("[pdtp-unverified-approvals] falló en el deploy; no se aborta: el paso es idempotente y el próximo deploy lo retoma.")
    process.exit(0)
  }
  process.exit(1)
})
