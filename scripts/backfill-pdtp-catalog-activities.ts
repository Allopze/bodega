import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpAccreditationBindings,
  pdtpActivities,
  pdtpCatalogActivities,
  pdtpCatalogActivityRevisions,
  pdtpFulfillmentEvents,
  pdtpFulfillmentEventTargets,
  pdtpPrograms,
  pdtpProgramWorksites,
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionInspectionTemplates,
  preventionTrainingCatalogItems,
  preventionTrainingCourses,
  sstDocumentTypes,
} from "@/db/schema"
import { chileDateParts } from "@/lib/utils"
import { PDTP_2026_CATALOG_ACTIVITIES } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import { planAnnualCatalogMappings } from "@/lib/services/pdtp/catalog-backfill"

const apply = process.argv.slice(2).includes("--apply")
const now = new Date().toISOString()
const catalogByNumber = new Map(PDTP_2026_CATALOG_ACTIVITIES.map((entry) => [entry.legacyNumber, entry]))
const stableId = (prefix: string, parts: string[]) => `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`

type BindingSeed = { sourceType: string; sourceId: string; eventType: "execute" | "review" | "publish" | "acknowledge" | "close" | "complete_drill"; catalogActivityId: string }

function mapNumbers(sourceType: string, sourceId: string, eventType: BindingSeed["eventType"], raw: unknown, issues: string[]) {
  if (!Array.isArray(raw)) return []
  const seeds: BindingSeed[] = []
  for (const value of raw) {
    const number = Number(value)
    const catalog = catalogByNumber.get(number)
    if (!catalog) issues.push(`${sourceType}:${sourceId}:${eventType} referencia N°${String(value)} sin identidad de catálogo.`)
    else seeds.push({ sourceType, sourceId, eventType, catalogActivityId: catalog.id })
  }
  return seeds
}

async function main() {
  const [annualActivities, programs, memberships, events, inspectionTemplates, trainingCourses, trainingItems, documentTypes, campaigns, emergencyPlans, existingCatalog] = await Promise.all([
    db.select({ id: pdtpActivities.id, programId: pdtpActivities.programId, n: pdtpActivities.n, activity: pdtpActivities.activity, program: pdtpActivities.program, catalogActivityId: pdtpActivities.catalogActivityId }).from(pdtpActivities),
    db.select({ id: pdtpPrograms.id, year: pdtpPrograms.year, status: pdtpPrograms.status }).from(pdtpPrograms),
    db.select({ programId: pdtpProgramWorksites.programId, worksiteId: pdtpProgramWorksites.worksiteId, isActive: pdtpProgramWorksites.isActive }).from(pdtpProgramWorksites),
    db.select().from(pdtpFulfillmentEvents),
    db.select({ id: preventionInspectionTemplates.id, execute: preventionInspectionTemplates.pdtpActivityNumbers, review: preventionInspectionTemplates.pdtpReviewActivityNumbers }).from(preventionInspectionTemplates),
    db.select({ id: preventionTrainingCourses.id, numbers: preventionTrainingCourses.pdtpActivityNumbers }).from(preventionTrainingCourses),
    db.select({ id: preventionTrainingCatalogItems.id, numbers: preventionTrainingCatalogItems.pdtpActivityNumbers }).from(preventionTrainingCatalogItems),
    db.select({ id: sstDocumentTypes.id, publish: sstDocumentTypes.pdtpActivityNumbers, acknowledge: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers }).from(sstDocumentTypes),
    db.select({ id: preventionCampaigns.id, numbers: preventionCampaigns.pdtpActivityNumbers }).from(preventionCampaigns),
    db.select({ id: preventionEmergencyPlans.id, numbers: preventionEmergencyPlans.pdtpActivityNumbers }).from(preventionEmergencyPlans),
    db.select().from(pdtpCatalogActivities),
  ])

  const plan = planAnnualCatalogMappings({ manifest: PDTP_2026_CATALOG_ACTIVITIES, annualActivities })
  const issues = [...plan.issues]
  for (const existing of existingCatalog) {
    const expected = PDTP_2026_CATALOG_ACTIVITIES.find((entry) => entry.id === existing.id)
    if (!expected || expected.code !== existing.code) issues.push(`La identidad existente ${existing.id} no coincide con la manifestación revisada.`)
  }

  const bindings: BindingSeed[] = []
  for (const row of inspectionTemplates) {
    bindings.push(...mapNumbers("inspeccion", row.id, "execute", row.execute, issues))
    bindings.push(...mapNumbers("inspeccion", row.id, "review", row.review, issues))
  }
  for (const row of trainingCourses) bindings.push(...mapNumbers("capacitacion", row.id, "close", row.numbers, issues))
  for (const row of trainingItems) bindings.push(...mapNumbers("capacitacion_ocurrencia", row.id, "close", row.numbers, issues))
  for (const row of documentTypes) {
    bindings.push(...mapNumbers("documento", row.id, "publish", row.publish, issues))
    bindings.push(...mapNumbers("documento", row.id, "acknowledge", row.acknowledge, issues))
  }
  for (const row of campaigns) bindings.push(...mapNumbers("campana", row.id, "close", row.numbers, issues))
  for (const row of emergencyPlans) bindings.push(...mapNumbers("emergencia", row.id, "complete_drill", row.numbers, issues))

  const membershipsByProgram = new Map<string, string[]>()
  for (const membership of memberships) {
    if (!membership.isActive) continue
    membershipsByProgram.set(membership.programId, [...(membershipsByProgram.get(membership.programId) ?? []), membership.worksiteId])
  }
  const annualByProgramAndNumber = new Map(plan.mappings.map((mapping) => [`${mapping.programId}:${mapping.n}`, mapping]))
  for (const annual of annualActivities) {
    if (annual.catalogActivityId) annualByProgramAndNumber.set(`${annual.programId}:${annual.n}`, { annualActivityId: annual.id, programId: annual.programId, n: annual.n, catalogActivityId: annual.catalogActivityId })
  }

  const eventTargets: Array<{ eventId: string; catalogActivityId: string; resolvedActivityId: string | null; activityNumberSnapshot: number }> = []
  for (const event of events) {
    const numbers = Array.isArray(event.activityNumbers) ? event.activityNumbers.map(Number) : []
    if (numbers.length === 0) continue
    const year = event.periodOverrideJson?.year ?? event.plannedYear ?? chileDateParts(event.occurredAt).year
    const candidates = event.programId
      ? programs.filter((program) => program.id === event.programId)
      : programs.filter((program) => {
        if (program.status !== "active" || program.year !== year) return false
        const scoped = membershipsByProgram.get(program.id) ?? []
        return scoped.length === 0 || scoped.includes(event.worksiteId)
      })
    if (candidates.length > 1) {
      issues.push(`Evento ${event.id}: hay ${candidates.length} programas posibles.`)
      continue
    }
    for (const number of numbers) {
      if (candidates.length === 0) {
        const catalog = catalogByNumber.get(number)
        if (!catalog) issues.push(`Evento ${event.id}: N°${number} no tiene identidad de catálogo.`)
        else eventTargets.push({ eventId: event.id, catalogActivityId: catalog.id, resolvedActivityId: null, activityNumberSnapshot: number })
        continue
      }
      const mapping = annualByProgramAndNumber.get(`${candidates[0]!.id}:${number}`)
      if (!mapping) issues.push(`Evento ${event.id}: N°${number} no existe en ${candidates[0]!.id}.`)
      else eventTargets.push({ eventId: event.id, catalogActivityId: mapping.catalogActivityId, resolvedActivityId: mapping.annualActivityId, activityNumberSnapshot: number })
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    manifest: PDTP_2026_CATALOG_ACTIVITIES.length,
    annualMappings: plan.mappings.length,
    bindings: bindings.length,
    eventTargets: eventTargets.length,
    events: events.length,
    issues,
  }
  if (issues.length > 0) throw new Error(`Backfill bloqueado:\n${issues.join("\n")}`)

  if (apply) {
    await db.transaction(async (tx) => {
      await tx.insert(pdtpCatalogActivities).values(PDTP_2026_CATALOG_ACTIVITIES.map((entry) => ({
        id: entry.id,
        code: entry.code,
        status: entry.status,
        currentRevision: 1,
        retiredReason: entry.status === "retired" ? "Retirada en el programa local antes del catálogo corporativo." : null,
        retiredAt: entry.status === "retired" ? now : null,
        createdAt: now,
        updatedAt: now,
      }))).onConflictDoNothing()
      await tx.insert(pdtpCatalogActivityRevisions).values(PDTP_2026_CATALOG_ACTIVITIES.map((entry) => ({
        id: `${entry.id}-r1`, catalogActivityId: entry.id, revision: 1, title: entry.title,
        description: entry.description, executionGuidance: entry.executionGuidance,
        changeNote: "Conversión 1:1 de la base local 2026", createdAt: now,
      }))).onConflictDoNothing()
      for (const mapping of plan.mappings) {
        await tx.update(pdtpActivities).set({ catalogActivityId: mapping.catalogActivityId, catalogRevision: 1, updatedAt: now })
          .where(and(eq(pdtpActivities.id, mapping.annualActivityId), eq(pdtpActivities.programId, mapping.programId)))
      }
      for (const binding of bindings) {
        await tx.insert(pdtpAccreditationBindings).values({
          id: stableId("pdtp-binding", [binding.sourceType, binding.sourceId, binding.eventType, binding.catalogActivityId]),
          ...binding, createdAt: now, updatedAt: now,
        }).onConflictDoNothing()
      }
      for (const target of eventTargets) {
        await tx.insert(pdtpFulfillmentEventTargets).values({
          id: stableId("pdtp-target", [target.eventId, target.catalogActivityId]),
          ...target, createdAt: now,
        }).onConflictDoNothing()
      }
    })
  }
  console.log(JSON.stringify({ ok: true, ...report }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
