/**
 * Puebla el motor de inspecciones con datos realistas para auditoría de UI/UX.
 *
 * Usa el servicio real (no INSERT crudo) para que los invariantes —hallazgos
 * derivados, cumplimiento, acreditación PDTP, historial— queden coherentes.
 * ponytail: script de auditoría, no de producción.
 */
import { db } from "@/db"
import { preventionInspectionPrograms, preventionInspectionRuns, preventionInspectionTemplates } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  approveInspectionTemplate,
  completeInspectionRun,
  createInspectionProgram,
  createInspectionRun,
  itemsFromDefinition,
  reviewInspectionRun,
  saveInspectionAnswers,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections"
import { createContainer, listContainersForWorksite } from "@/lib/services/prevention-containers"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { closingActFromDefinition, fieldKindAcceptsPartial, fieldKindIsScorable } from "@/lib/prevention/inspections"

const ALL: InspectionAccess = {
  userId: "demo-user-prevencionista",
  scope: { mode: "all", ids: [] },
  permissions: [
    "prevention:inspections:view", "prevention:inspections:execute", "prevention:inspections:manage",
    "prevention:inspections:review", "prevention:inspections:approve", "prevention:inspections:export",
    "prevention:inspections:ingest", "prevention:capa:manage", "prevention:capa:view",
  ],
}
const asUser = (userId: string): InspectionAccess => ({ ...ALL, userId })

/** Acceso al catálogo de contenedores, que es dato maestro de Administración. */
const CONTAINER_ACCESS = {
  userId: "demo-user-prevencionista",
  permissions: ["admin:containers"],
  scope: "all" as const,
}

/**
 * El contenedor dejó de ser texto libre: la inspección del Anexo 14 exige uno
 * del catálogo, así que la demo tiene que sembrarlo antes de ejecutarla.
 */
async function ensureDemoContainer(worksiteId: string, code: string, location: string) {
  const existing = await listContainersForWorksite(worksiteId)
  const found = existing.find((item) => item.code === code)
  if (found) return found.id
  const created = await createContainer({ worksiteId, code, location }, CONTAINER_ACCESS)
  return created.id
}

function daysFromToday(delta: number) {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

async function approveAll() {
  const drafts = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.status, "draft"))
  for (const t of drafts) {
    try {
      await approveInspectionTemplate(
        { templateId: t.id, expectedVersion: t.version, reason: "Instrumento vigente del catálogo SST 2026; se habilita para uso en faena." },
        ALL,
      )
      console.log(`  aprobada: ${t.name} (${t.versionLabel})`)
    } catch (error) {
      console.log(`  ! ${t.name}: ${(error as Error).message}`)
    }
  }
}

/** Respuestas plausibles: mayoría conforme, algunas parciales y no conformes. */
function buildAnswers(definition: ChecklistDefinition, seed: number) {
  const items = itemsFromDefinition(definition)
  return items.map((item, index) => {
    const roll = (index * 7 + seed * 13) % 10
    if (!fieldKindIsScorable(item.kind)) {
      const value = item.kind === "date" ? daysFromToday(180)
        : item.kind === "number" ? String(10 + ((index + seed) % 40))
        : item.options?.length ? item.options[(index + seed) % item.options.length]!.value
        : `Registrado en terreno ${index + 1}`
      return { sectionId: item.sectionId, itemId: item.itemId, result: "recorded" as const, value, comment: null }
    }
    if (roll === 0) return { sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming" as const, value: null, comment: "Se detecta el incumplimiento en terreno; se instruye correccion inmediata al supervisor a cargo." }
    if (roll === 1 && fieldKindAcceptsPartial(item.kind)) return { sectionId: item.sectionId, itemId: item.itemId, result: "partial" as const, value: null, comment: "Cumple parcialmente: falta completar la senalizacion del sector poniente." }
    if (roll === 2) return { sectionId: item.sectionId, itemId: item.itemId, result: "not_applicable" as const, value: null, comment: "No aplica al alcance de esta faena." }
    return { sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const, value: null, comment: null }
  })
}

/** Acta de cierre plausible: primer resultado ofrecido y todas las firmas. */
function buildClosingAct(definition: ChecklistDefinition, executorName: string) {
  const spec = closingActFromDefinition(definition as never)
  if (!spec) return undefined
  return {
    result: spec.resultOptions[0]!.value,
    restrictions: null,
    signatures: spec.signatureRoles.map((role) => ({ role, name: executorName, userId: null })),
  }
}

async function main() {
  console.log("1) Aprobando plantillas del catálogo…")
  await approveAll()

  const templates = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.status, "approved"))
  const byName = (needle: string) => templates.find((t) => t.name.toLowerCase().includes(needle.toLowerCase()))

  console.log("2) Creando programaciones (se limpian las previas del script)…")
  await db.delete(preventionInspectionPrograms)
  const programPlan: { template?: typeof templates[number]; worksite: string; frequency: string; startsOn: string; assignee: string | null }[] = [
    { template: byName("extintores"), worksite: "ws-arauco-horcones", frequency: "monthly", startsOn: daysFromToday(-12), assignee: "demo-user-prevencionista_faena" },
    { template: byName("extintores"), worksite: "ws-biodiversa", frequency: "monthly", startsOn: daysFromToday(9), assignee: "demo-user-prevencionista_faena" },
    { template: byName("contenedores"), worksite: "ws-arauco-horcones", frequency: "quarterly", startsOn: daysFromToday(-3), assignee: null },
    { template: byName("Equipos Móviles"), worksite: "ws-cholguan", frequency: "weekly", startsOn: daysFromToday(2), assignee: "demo-user-jefe_terreno" },
    { template: byName("EPP (PRF)"), worksite: "ws-administracion", frequency: "monthly", startsOn: daysFromToday(-25), assignee: "demo-user-prevencionista_faena" },
    { template: byName("Taller de Mantención"), worksite: "ws-masisa", frequency: "biannual", startsOn: daysFromToday(45), assignee: null },
    { template: byName("Auditoría interna"), worksite: "ws-administracion", frequency: "annual", startsOn: daysFromToday(120), assignee: "demo-user-prevencionista" },
    { template: byName("Ampliroll"), worksite: "ws-biodiversa", frequency: "monthly", startsOn: daysFromToday(-1), assignee: "demo-user-prevencionista_faena" },
  ]
  for (const plan of programPlan) {
    if (!plan.template) continue
    try {
      await createInspectionProgram({
        templateId: plan.template.id, worksiteId: plan.worksite,
        frequency: plan.frequency, startsOn: plan.startsOn,
        assignedToUserId: plan.assignee,
      }, ALL)
      console.log(`  programada: ${plan.template.name} @ ${plan.worksite} (${plan.frequency}, ${plan.startsOn})`)
    } catch (error) {
      console.log(`  ! ${plan.template.name}: ${(error as Error).message}`)
    }
  }

  console.log("3) Creando ejecuciones con respuestas reales…")
  const contenedorRespel = await ensureDemoContainer("ws-biodiversa", "CT-RESPEL-02", "Patio de residuos")
  const runPlan = [
    // planificadas (una vencida)
    { template: byName("extintores"), worksite: "ws-arauco-horcones", scheduledFor: daysFromToday(-6), assignee: "demo-user-prevencionista_faena", stage: "planned" as const, subject: "Extintor PQS 10 kg — Portería" },
    { template: byName("contenedores"), worksite: "ws-biodiversa", scheduledFor: daysFromToday(3), assignee: "demo-user-prevencionista_faena", stage: "planned" as const, subject: "Contenedor RESPEL N°2", containerId: contenedorRespel },
    // en curso (parcialmente respondidas)
    { template: byName("Reporte de Uso Diario"), worksite: "ws-administracion", scheduledFor: daysFromToday(0), assignee: "demo-user-jefe_terreno", stage: "in_progress" as const, subject: "Cargador CAT 950 — turno mañana" },
    { template: byName("Maquinaria Pesada"), worksite: "ws-arauco-horcones", scheduledFor: daysFromToday(-8), assignee: "demo-user-prevencionista_faena", stage: "in_progress" as const, subject: "Operador excavadora EX-07" },
    { template: byName("Equipos Móviles"), worksite: "ws-cholguan", scheduledFor: daysFromToday(-2), assignee: "demo-user-jefe_terreno", stage: "in_progress" as const, subject: "Cargador frontal CF-04" },
    // ejecutadas, pendientes de revisión
    { template: byName("extintores"), worksite: "ws-biodiversa", scheduledFor: daysFromToday(-1), assignee: "demo-user-prevencionista_faena", stage: "completed" as const, subject: "Extintor CO2 5 kg — Sala eléctrica" },
    { template: byName("Ampliroll"), worksite: "ws-biodiversa", scheduledFor: daysFromToday(-1), assignee: "demo-user-prevencionista_faena", stage: "completed" as const, subject: "Camión Ampliroll AA-1023" },
    { template: byName("Taller de Mantención"), worksite: "ws-masisa", scheduledFor: daysFromToday(-4), assignee: "demo-user-prevencionista_faena", stage: "completed" as const, subject: "Taller central" },
    // revisadas
    { template: byName("EPP (PRF)"), worksite: "ws-arauco-horcones", scheduledFor: daysFromToday(-15), assignee: "demo-user-prevencionista_faena", stage: "reviewed" as const, subject: "Cuadrilla forestal" },
    { template: byName("Auditoría interna"), worksite: "ws-administracion", scheduledFor: daysFromToday(-30), assignee: "demo-user-prevencionista", stage: "reviewed" as const, subject: "SGSST 2026" },
  ]

  let seed = 1
  for (const plan of runPlan) {
    if (!plan.template) continue
    seed += 1
    try {
      const { run } = await createInspectionRun({
        templateId: plan.template.id, worksiteId: plan.worksite,
        origin: plan.template.kind === "audit" ? "prevencion" : "prevencion",
        subjectType: null, subjectLabel: plan.subject,
        // El resto de los sujetos sigue siendo etiqueta libre; el contenedor no.
        subjectContainerId: "containerId" in plan ? plan.containerId : undefined,
        scheduledFor: plan.scheduledFor, assignedToUserId: plan.assignee,
      }, ALL)

      if (plan.stage === "planned") { console.log(`  planificada: ${run.code} ${plan.template.name}`); continue }

      const executor = asUser(plan.assignee ?? "demo-user-prevencionista_faena")
      const definition = plan.template.definitionSnapshot as ChecklistDefinition
      const all = buildAnswers(definition, seed)
      const partial = all.slice(0, Math.max(1, Math.floor(all.length * 0.45)))

      if (plan.stage === "in_progress") {
        await saveInspectionAnswers({ runId: run.id, expectedVersion: run.version, answers: partial }, executor)
        console.log(`  en curso: ${run.code} (${partial.length}/${all.length} ítems)`)
        continue
      }

      const done = await completeInspectionRun({
        runId: run.id, expectedVersion: run.version, answers: all,
        closingAct: buildClosingAct(definition, "Prevencionista faena"),
        locationLatitude: "-37.145820", locationLongitude: "-73.158390",
      }, executor)
      console.log(`  ejecutada: ${run.code} · ${done.compliancePercent}% · ${done.findings} hallazgo(s)`)

      if (plan.stage === "reviewed") {
        const [fresh] = await db.select().from(preventionInspectionRuns).where(eq(preventionInspectionRuns.id, run.id)).limit(1)
        await reviewInspectionRun({
          runId: run.id, expectedVersion: fresh!.version,
          reviewComment: "Revisada por Prevención: los hallazgos quedaron derivados a CAPA y se verificó la evidencia adjunta.",
        }, asUser("demo-user-prevencionista"))
        console.log(`  revisada: ${run.code}`)
      }
    } catch (error) {
      console.log(`  ! ${plan.template.name}: ${(error as Error).message}`)
    }
  }

  const programs = await db.select().from(preventionInspectionPrograms)
  console.log(`\nListo. Programaciones: ${programs.length}.`)
  process.exit(0)
}

void main()
