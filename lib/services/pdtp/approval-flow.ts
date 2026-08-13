import { and, asc, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpApprovalDecisions, pdtpApprovalSteps, pdtpPrograms } from "@/db/schema"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"
import { onPdtpProgramLegallyApproved } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState, isUniqueViolation } from "./helpers"
import { computePdtpProgramContentDigest } from "./content-digest"

type QueryClient = Tx | typeof db

export type PdtpApprovalSegregationRule =
  | "not_elaborator"
  | "different_from_previous"
  | `different_from_step:${string}`

export type PdtpApprovalStepInput = {
  code: string
  label: string
  requiredPermission: string
  isRequired?: boolean
  segregationRules?: PdtpApprovalSegregationRule[]
}

export const DEFAULT_PDTP_APPROVAL_STEPS: readonly PdtpApprovalStepInput[] = [
  {
    code: "jdpr",
    label: "Revisión técnica JDPR",
    requiredPermission: "prevention:pdtp:approve",
    segregationRules: ["not_elaborator"],
  },
  {
    code: "legal",
    label: "Aprobación Legal y RRHH",
    requiredPermission: "prevention:pdtp:sign_legal",
    segregationRules: ["different_from_previous"],
  },
]

export function approvalDecisionId(programId: string, contentVersion: number, stepCode: string) {
  return `${programId}-approval-v${contentVersion}-${stepCode}`
}

function isValidRule(rule: string, knownCodes: Set<string>): rule is PdtpApprovalSegregationRule {
  if (rule === "not_elaborator" || rule === "different_from_previous") return true
  if (!rule.startsWith("different_from_step:")) return false
  const target = rule.slice("different_from_step:".length)
  return knownCodes.has(target)
}

export async function listPdtpApprovalSteps(programId: string, client: QueryClient = db) {
  return client.select().from(pdtpApprovalSteps)
    .where(eq(pdtpApprovalSteps.programId, programId))
    .orderBy(asc(pdtpApprovalSteps.stepOrder))
}

export async function listPdtpApprovalDecisions(
  programId: string,
  contentVersion?: number,
  client: QueryClient = db,
) {
  const conditions = [eq(pdtpApprovalDecisions.programId, programId)]
  if (contentVersion !== undefined) conditions.push(eq(pdtpApprovalDecisions.contentVersion, contentVersion))
  return client.select().from(pdtpApprovalDecisions)
    .where(and(...conditions))
    .orderBy(asc(pdtpApprovalDecisions.contentVersion), asc(pdtpApprovalDecisions.stepOrder))
}

export async function getPdtpApprovalProgress(programId: string, client: QueryClient = db) {
  const [program] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const [steps, decisions] = await Promise.all([
    listPdtpApprovalSteps(programId, client),
    listPdtpApprovalDecisions(programId, program.contentVersion, client),
  ])
  const decisionByCode = new Map(decisions.map((decision) => [decision.stepCode, decision]))
  return steps.map((step) => ({ ...step, decision: decisionByCode.get(step.code) ?? null }))
}

export async function ensureDefaultPdtpApprovalSteps(programId: string, client: QueryClient = db) {
  const existing = await listPdtpApprovalSteps(programId, client)
  if (existing.length > 0) return existing
  const now = new Date().toISOString()
  await client.insert(pdtpApprovalSteps).values(DEFAULT_PDTP_APPROVAL_STEPS.map((step, index) => ({
    id: `${programId}-approval-${step.code}`,
    programId,
    stepOrder: index + 1,
    code: step.code,
    label: step.label,
    requiredPermission: step.requiredPermission,
    isRequired: step.isRequired ?? true,
    segregationRules: step.segregationRules ?? [],
    createdAt: now,
    updatedAt: now,
  }))).onConflictDoNothing()
  return listPdtpApprovalSteps(programId, client)
}

export async function copyPdtpApprovalSteps(sourceProgramId: string, targetProgramId: string, client: QueryClient = db) {
  const source = await listPdtpApprovalSteps(sourceProgramId, client)
  if (source.length === 0) return ensureDefaultPdtpApprovalSteps(targetProgramId, client)
  const now = new Date().toISOString()
  await client.insert(pdtpApprovalSteps).values(source.map((step) => ({
    id: `${targetProgramId}-approval-${step.code}`,
    programId: targetProgramId,
    stepOrder: step.stepOrder,
    code: step.code,
    label: step.label,
    requiredPermission: step.requiredPermission,
    isRequired: step.isRequired,
    segregationRules: step.segregationRules,
    createdAt: now,
    updatedAt: now,
  }))).onConflictDoNothing()
  return listPdtpApprovalSteps(targetProgramId, client)
}

export async function replacePdtpApprovalSteps(programId: string, rawSteps: PdtpApprovalStepInput[], userId: string) {
  if (rawSteps.length === 0) throw new Error("El flujo debe contener al menos un paso de aprobación.")
  const permissionNames = new Set<string>(ALL_MODULE_PERMISSIONS)
  const knownCodes = new Set(rawSteps.map((step) => step.code.trim().toLowerCase()))
  if (knownCodes.size !== rawSteps.length) throw new Error("Los códigos de los pasos no pueden repetirse.")

  const steps = rawSteps.map((step) => {
    const code = step.code.trim().toLowerCase()
    const label = step.label.trim()
    if (!/^[a-z0-9_]+$/.test(code)) throw new Error("El código del paso solo admite letras minúsculas, números y guion bajo.")
    if (label.length < 3 || label.length > 200) throw new Error(`La etiqueta del paso ${code} debe tener entre 3 y 200 caracteres.`)
    if (!permissionNames.has(step.requiredPermission)) throw new Error(`El permiso ${step.requiredPermission} no existe en el registro.`)
    const rules = [...new Set(step.segregationRules ?? [])]
    if (rules.some((rule) => !isValidRule(rule, knownCodes))) throw new Error(`El paso ${code} contiene una regla de segregación desconocida.`)
    if (rules.includes(`different_from_step:${code}`)) throw new Error(`El paso ${code} no puede segregarse de sí mismo.`)
    return { ...step, code, label, segregationRules: rules }
  })
  if (!steps.some((step) => step.isRequired ?? true)) throw new Error("El flujo debe contener al menos un paso obligatorio.")

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)
    const before = await listPdtpApprovalSteps(programId, tx)
    await tx.delete(pdtpApprovalSteps).where(eq(pdtpApprovalSteps.programId, programId))
    const now = new Date().toISOString()
    const created = await tx.insert(pdtpApprovalSteps).values(steps.map((step, index) => ({
      id: `${programId}-approval-${step.code}`,
      programId,
      stepOrder: index + 1,
      code: step.code,
      label: step.label,
      requiredPermission: step.requiredPermission,
      isRequired: step.isRequired ?? true,
      segregationRules: step.segregationRules,
      createdAt: now,
      updatedAt: now,
    }))).returning()
    await addPdtpChangeLogEntry(
      programId,
      program.version,
      userId,
      "approval_flow",
      { steps: before.map(({ id: _id, programId: _programId, createdAt: _createdAt, updatedAt: _updatedAt, ...step }) => step) },
      { steps: created.map(({ id: _id, programId: _programId, createdAt: _createdAt, updatedAt: _updatedAt, ...step }) => step) },
      "Flujo de aprobación actualizado.",
      tx,
    )
    return created
  })
}

export async function getPdtpApprovalStep(stepId: string) {
  const [step] = await db.select().from(pdtpApprovalSteps).where(eq(pdtpApprovalSteps.id, stepId)).limit(1)
  return step ?? null
}

export async function listPdtpApprovalProgress(programId: string, client: QueryClient = db) {
  const [program] = await client.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  return { program, steps: await getPdtpApprovalProgress(programId, client) }
}

function decisionReason(decision: "approved" | "rejected", rawReason?: string) {
  if (decision === "approved") return null
  const reason = rawReason?.trim() ?? ""
  if (reason.length < 10) throw new Error("El motivo del rechazo debe tener al menos 10 caracteres.")
  if (reason.length > 3000) throw new Error("El motivo del rechazo no puede superar 3000 caracteres.")
  return reason
}

export async function decidePdtpApprovalStep(args: {
  programId: string
  stepId?: string
  stepCode?: string
  actorUserId?: string
  userId?: string
  decision: "approved" | "rejected"
  reason?: string
}) {
  const reason = decisionReason(args.decision, args.reason)
  const actorUserId = args.actorUserId ?? args.userId
  if (!actorUserId) throw new Error("Usuario decisor requerido.")
  if (!args.stepId && !args.stepCode) throw new Error("Paso de aprobación requerido.")
  // La N°1 del programa ("Aprobar el Programa de Prevención de Riesgos") se
  // cumple con la firma de Legal y RRHH sobre este mismo programa. Se acredita
  // DESPUÉS del commit para no dejar ejecuciones huérfanas si la decisión se
  // revierte.
  let programApproved: { programId: string; approvedAt: string } | null = null
  try {
    const result = await db.transaction(async (tx) => {
      const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, args.programId)).limit(1)
      if (!program) throw new Error("Programa PDTP no encontrado.")
      const [step] = await tx.select().from(pdtpApprovalSteps).where(and(
        args.stepId
          ? eq(pdtpApprovalSteps.id, args.stepId)
          : eq(pdtpApprovalSteps.code, args.stepCode!.trim().toLowerCase()),
        eq(pdtpApprovalSteps.programId, args.programId),
      )).limit(1)
      if (!step) throw new Error("Paso de aprobación no encontrado para este programa.")

      const decisions = await listPdtpApprovalDecisions(args.programId, program.contentVersion, tx)
      const existing = decisions.find((item) => item.stepCode === step.code)
      if (existing) {
        if (
          existing.actorUserId === actorUserId
          && existing.decision === args.decision
          && (existing.reason ?? null) === reason
        ) return { program, step, decision: existing }
        throw new Error(`El paso ${step.label} ya fue resuelto para esta versión.`)
      }
      if (program.status !== "in_review" || !program.contentDigest) {
        throw new Error("El programa debe estar en revisión sobre una huella válida.")
      }

      const steps = await listPdtpApprovalSteps(args.programId, tx)
      const decisionByCode = new Map(decisions.map((item) => [item.stepCode, item]))
      const missingPrevious = steps.find((item) => (
        item.stepOrder < step.stepOrder
        && item.isRequired
        && decisionByCode.get(item.code)?.decision !== "approved"
      ))
      if (missingPrevious) throw new Error(`Primero debe aprobarse el paso ${missingPrevious.label}.`)

      const { digest } = await computePdtpProgramContentDigest(args.programId, tx)
      if (digest !== program.contentDigest) {
        throw new Error("El contenido cambió después de enviarse a revisión. Debe abrirse una nueva revisión.")
      }

      const rules = step.segregationRules as PdtpApprovalSegregationRule[]
      if (rules.includes("not_elaborator") && program.elaboratedByUserId === actorUserId) {
        throw new Error(`La persona que elaboró el programa no puede resolver el paso ${step.label}.`)
      }
      if (rules.includes("different_from_previous")) {
        const previous = [...steps].reverse().find((item) => item.stepOrder < step.stepOrder)
        if (previous && decisionByCode.get(previous.code)?.actorUserId === actorUserId) {
          throw new Error(`${previous.label} y ${step.label} deben ser resueltos por personas distintas.`)
        }
      }
      for (const rule of rules) {
        if (!rule.startsWith("different_from_step:")) continue
        const comparedCode = rule.slice("different_from_step:".length)
        if (decisionByCode.get(comparedCode)?.actorUserId === actorUserId) {
          throw new Error(`Los pasos ${comparedCode} y ${step.label} deben ser resueltos por personas distintas.`)
        }
      }

      const now = new Date().toISOString()
      const programUpdates: Partial<typeof pdtpPrograms.$inferInsert> = { updatedAt: now }
      if (args.decision === "rejected") {
        programUpdates.status = "rejected"
        programUpdates.rejectedByUserId = actorUserId
        programUpdates.rejectedAt = now
        programUpdates.rejectionReason = reason
      } else if (step.code === "jdpr") {
        programUpdates.approvedByJdprUserId = actorUserId
        programUpdates.approvedByJdprAt = now
      } else if (step.code === "legal") {
        programUpdates.approvedByLegalUserId = actorUserId
        programUpdates.approvedByLegalAt = now
        programApproved = { programId: args.programId, approvedAt: now }
      }

      const [updated] = await tx.update(pdtpPrograms).set(programUpdates).where(and(
        eq(pdtpPrograms.id, args.programId),
        eq(pdtpPrograms.status, "in_review"),
        eq(pdtpPrograms.contentVersion, program.contentVersion),
        eq(pdtpPrograms.contentDigest, program.contentDigest),
        eq(pdtpPrograms.updatedAt, program.updatedAt),
      )).returning()
      if (!updated) throw new Error("El programa cambió mientras se registraba la decisión.")

      const [created] = await tx.insert(pdtpApprovalDecisions).values({
        id: approvalDecisionId(args.programId, program.contentVersion, step.code),
        programId: args.programId,
        stepId: step.id,
        stepCode: step.code,
        stepLabel: step.label,
        stepOrder: step.stepOrder,
        requiredPermission: step.requiredPermission,
        segregationRulesSnapshot: step.segregationRules,
        contentVersion: program.contentVersion,
        contentDigest: program.contentDigest,
        decision: args.decision,
        actorUserId,
        reason,
        decidedAt: now,
      }).returning()
      if (!created) throw new Error("No se pudo registrar la decisión del programa.")

      await addPdtpChangeLogEntry(
        args.programId,
        program.version,
        actorUserId,
        `approval:${step.code}`,
        null,
        { stepCode: step.code, decision: args.decision, contentVersion: program.contentVersion, contentDigest: program.contentDigest, reason },
        args.decision === "approved" ? `${step.label}: aprobado.` : `${step.label}: rechazado. ${reason}`,
        tx,
      )
      return { program: updated, step, decision: created }
    })
    if (programApproved) await onPdtpProgramLegallyApproved(programApproved)
    return result
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("Este paso ya fue resuelto por otra solicitud.")
    throw error
  }
}

export async function assertAllRequiredPdtpApprovalStepsApproved(
  programId: string,
  contentVersion: number,
  contentDigest: string,
  client: QueryClient = db,
) {
  const [steps, decisions] = await Promise.all([
    listPdtpApprovalSteps(programId, client),
    listPdtpApprovalDecisions(programId, contentVersion, client),
  ])
  if (steps.length === 0) throw new Error("El programa no tiene un flujo de aprobación configurado.")
  const approved = new Set(
    decisions
      .filter((decision) => decision.decision === "approved" && decision.contentDigest === contentDigest)
      .map((decision) => decision.stepCode),
  )
  const pending = steps.filter((step) => step.isRequired && !approved.has(step.code))
  if (pending.length > 0) throw new Error(`Faltan aprobaciones obligatorias: ${pending.map((step) => step.label).join(", ")}.`)
}
