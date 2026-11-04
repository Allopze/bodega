import * as schema from "../../db/schema"
import {
  chance,
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  pick,
  shortHash,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedPrevencion(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  if (base.workers.length === 0) {
    return { domain: "prevencion", inserted: 0, skipped: 0, notes: ["No hay trabajadores activos; no se sembró prevención."] }
  }

  // ── Solicitudes de derechos de privacidad ─────────────────────────────────
  const privacyCount = await countRows(sql, "prevention_privacy_requests")
  if (privacyCount < 6) {
    const rightTypes = ["access", "rectification", "deletion", "opposition", "portability", "restriction"] as const
    const statuses = ["recibida", "validando_identidad", "en_proceso", "completada", "rechazada", "en_proceso"] as const
    const requests: (typeof schema.preventionPrivacyRequests.$inferInsert)[] = Array.from({ length: 6 }, (_, index) => {
      const worker = base.workers[index % base.workers.length]!
      const received = daysAgo(today, int(rng, 5, 45))
      const status = statuses[index]!
      const completed = status === "completada" || status === "rechazada"
      return {
        id: devId("privacy-request", index + 1),
        subjectWorkerId: worker.id,
        rightType: rightTypes[index]!,
        status,
        requestScope: index % 2 === 0 ? "Antecedentes de salud y capacitación" : "Datos de contacto y dotación",
        receivedAt: iso(received),
        dueAt: iso(new Date(received.getTime() + 30 * 86_400_000)),
        handledByUserId: status === "recibida" ? null : actors.adminUserId,
        createdByUserId: actors.adminUserId,
        identityVerifiedAt: status === "recibida" ? null : iso(new Date(received.getTime() + 2 * 86_400_000)),
        identityVerifiedByUserId: status === "recibida" ? null : actors.adminUserId,
        completedAt: completed ? iso(new Date(received.getTime() + 20 * 86_400_000)) : null,
        decisionReason: completed ? "Solicitud gestionada en el entorno de demostración." : null,
        legalHold: false,
        legalHoldReason: null,
        createdAt: iso(received),
        updatedAt: iso(daysAgo(today, int(rng, 1, 5))),
      }
    })
    const history: (typeof schema.preventionPrivacyRequestHistory.$inferInsert)[] = requests.flatMap((request, index) => [
      {
        id: devId("privacy-history", index * 2 + 1),
        requestId: request.id!,
        fromStatus: null,
        toStatus: "recibida",
        reason: "Recepción de la solicitud de demostración.",
        actorUserId: actors.adminUserId,
        createdAt: request.receivedAt as string,
      },
      {
        id: devId("privacy-history", index * 2 + 2),
        requestId: request.id!,
        fromStatus: "recibida",
        toStatus: request.status!,
        reason: "Actualización de estado de demostración.",
        actorUserId: actors.adminUserId,
        createdAt: request.updatedAt as string,
      },
    ])
    const deliveries: (typeof schema.preventionPrivacyDeliveries.$inferInsert)[] = requests
      .filter((request) => request.status === "completada")
      .map((request, index) => ({
        id: devId("privacy-delivery", index + 1),
        requestId: request.id!,
        format: "xlsx",
        includesClinical: false,
        healthRecordCount: "0",
        checksumSha256: shortHash(`dev-privacy-delivery-${index + 1}`),
        purpose: "Entrega de antecedentes al titular en el entorno de desarrollo.",
        deliveredByUserId: actors.adminUserId,
        deliveredAt: iso(daysAgo(today, 3 + index)),
      }))
    if (apply) {
      inserted += await insertBatch(requests, async (chunk) =>
        (await db.insert(schema.preventionPrivacyRequests).values(chunk).onConflictDoNothing().returning({ id: schema.preventionPrivacyRequests.id })).length,
      )
      inserted += await insertBatch(history, async (chunk) =>
        (await db.insert(schema.preventionPrivacyRequestHistory).values(chunk).onConflictDoNothing().returning({ id: schema.preventionPrivacyRequestHistory.id })).length,
      )
      inserted += await insertBatch(deliveries, async (chunk) =>
        (await db.insert(schema.preventionPrivacyDeliveries).values(chunk).onConflictDoNothing().returning({ id: schema.preventionPrivacyDeliveries.id })).length,
      )
    } else {
      skipped += requests.length + history.length + deliveries.length
    }
  } else {
    skipped += 6
  }

  // ── Emergencias: contactos, simulacros y evidencia ────────────────────────
  const plans = await db.select().from(schema.preventionEmergencyPlans).limit(5)
  const scenarioTypes = await db.select().from(schema.preventionEmergencyScenarioTypes).limit(10)
  if (plans.length > 0 && scenarioTypes.length > 0) {
    const contactCount = await countRows(sql, "prevention_emergency_contacts")
    if (contactCount < 3) {
      const contacts: (typeof schema.preventionEmergencyContacts.$inferInsert)[] = plans.slice(0, 2).flatMap((plan, index) => [
        { id: devId("emergency-contact", index * 2 + 1), planId: plan.id, name: "Bomberos de demostración", org: "Bomberos", role: "Emergencias", phone: "+56 132" },
        { id: devId("emergency-contact", index * 2 + 2), planId: plan.id, name: "Ambulancia de demostración", org: "SAMU", role: "Salud", phone: "+56 131" },
      ])
      if (apply) {
        inserted += await insertBatch(contacts, async (chunk) =>
          (await db.insert(schema.preventionEmergencyContacts).values(chunk).onConflictDoNothing().returning({ id: schema.preventionEmergencyContacts.id })).length,
        )
      } else {
        skipped += contacts.length
      }
    } else {
      skipped += 3
    }

    const drillCount = await countRows(sql, "prevention_emergency_drills")
    if (drillCount < 6) {
      const drills: (typeof schema.preventionEmergencyDrills.$inferInsert)[] = Array.from({ length: 8 }, (_, index) => {
        const plan = plans[index % plans.length]!
        const scenario = scenarioTypes[index % scenarioTypes.length]!
        const scheduled = daysAgo(today, int(rng, 5, 150))
        const completed = index < 6
        return {
          id: devId("emergency-drill", index + 1),
          planId: plan.id,
          worksiteId: plan.worksiteId,
          scenarioType: scenario.code,
          scenarioTypeLabelSnapshot: scenario.label ?? scenario.code,
          scheduledFor: iso(scheduled),
          executedAt: completed ? iso(new Date(scheduled.getTime() + 3_600_000)) : null,
          status: completed ? "completed" : "scheduled",
          durationMinutes: completed ? int(rng, 20, 90) : null,
          evacuationSeconds: completed ? int(rng, 60, 300) : null,
          observations: completed ? "Simulacro de demostración ejecutado sin incidentes." : null,
          outcome: completed ? (chance(rng, 0.3) ? "needs_improvement" : "satisfactory") : null,
          evidencePath: null,
          evidenceChecksumSha256: null,
          createdByUserId: actors.adminUserId,
          version: 1,
          createdAt: iso(daysAgo(today, int(rng, 10, 160))),
          updatedAt: iso(daysAgo(today, int(rng, 1, 10))),
        }
      })
      const evidence: (typeof schema.preventionEmergencyDrillEvidence.$inferInsert)[] = drills
        .filter((drill) => drill.status === "completed")
        .slice(0, 4)
        .map((drill, index) => ({
          id: devId("emergency-evidence", index + 1),
          drillId: drill.id!,
          fileName: `acta-simulacro-${index + 1}.pdf`,
          storagePath: `dev/emergencias/acta-simulacro-${index + 1}.pdf`,
          mimeType: "application/pdf",
          fileSizeBytes: 120_000,
          sha256: shortHash(`dev-emergency-evidence-${index + 1}`),
          state: "active",
          uploadedByUserId: actors.adminUserId,
          uploadedAt: iso(daysAgo(today, int(rng, 1, 10))),
        }))
      if (apply) {
        inserted += await insertBatch(drills, async (chunk) =>
          (await db.insert(schema.preventionEmergencyDrills).values(chunk).onConflictDoNothing().returning({ id: schema.preventionEmergencyDrills.id })).length,
        )
        inserted += await insertBatch(evidence, async (chunk) =>
          (await db.insert(schema.preventionEmergencyDrillEvidence).values(chunk).onConflictDoNothing().returning({ id: schema.preventionEmergencyDrillEvidence.id })).length,
        )
      } else {
        skipped += drills.length + evidence.length
      }
    } else {
      skipped += 6
    }
  } else {
    notes.push("No hay planes de emergencia o tipos de escenario; se omiten los simulacros.")
  }

  // ── Documentos SST: versiones y acuses ────────────────────────────────────
  const categories = await db.select().from(schema.sstDocumentCategories).limit(5)
  const versions = await db.select().from(schema.sstDocumentVersions).limit(20)
  const users = await db.select({ id: schema.users.id }).from(schema.users).limit(10)
  if (categories.length > 0) {
    const versionCount = versions.length
    if (versionCount < 12) {
      const newDocuments: (typeof schema.sstDocuments.$inferInsert)[] = []
      const newVersions: (typeof schema.sstDocumentVersions.$inferInsert)[] = []
      for (let index = 0; index < 12 - versionCount; index++) {
        const documentId = devId("sst-doc", index + 1)
        const versionId = devId("sst-version", index + 1)
        const category = pick(rng, categories)
        newDocuments.push({
          id: documentId,
          categorySlug: category.slug,
          typeId: null,
          folderId: null,
          internalCode: `SST-DEV-${String(index + 1).padStart(3, "0")}`,
          title: `Documento SST de demostración ${index + 1}`,
          description: "Documento generado para el entorno de desarrollo.",
          worksiteId: base.worksites[index % base.worksites.length]?.id ?? null,
          status: "vigente",
          confidentiality: "publico_interno",
          dataClass: "operational",
          currentVersionId: versionId,
          effectiveFrom: dateOnly(daysAgo(today, 60)),
          expiresAt: dateOnly(daysAgo(today, -180)),
          responsibleUserId: actors.adminUserId,
          uploadedBy: actors.adminUserId,
          reviewedBy: actors.adminUserId,
          approvedBy: actors.adminUserId,
          approvedAt: iso(daysAgo(today, 60)),
          requiresAcknowledgment: true,
          tags: [],
          extraMetadata: { origen: "dev-seed" },
          checksum: shortHash(`dev-sst-doc-${index + 1}`),
          createdAt: iso(daysAgo(today, 60)),
          updatedAt: iso(daysAgo(today, 60)),
        })
        newVersions.push({
          id: versionId,
          documentId,
          version: 1,
          status: "vigente",
          fileName: `documento-sst-${index + 1}.pdf`,
          storageName: `dev-sst-documento-${index + 1}.pdf`,
          filePath: `dev/sst/documento-sst-${index + 1}.pdf`,
          mimeType: "application/pdf",
          fileSize: 120_000,
          checksum: shortHash(`dev-sst-version-${index + 1}`),
          effectiveFrom: dateOnly(daysAgo(today, 60)),
          effectiveTo: dateOnly(daysAgo(today, -180)),
          changelog: "Versión inicial de demostración.",
          uploadedBy: actors.adminUserId,
          reviewedBy: actors.adminUserId,
          approvedBy: actors.adminUserId,
          approvedAt: iso(daysAgo(today, 60)),
          supersedesId: null,
          approvalMode: "not_required",
          createdAt: iso(daysAgo(today, 60)),
          updatedAt: iso(daysAgo(today, 60)),
        })
      }
      if (apply) {
        inserted += await insertBatch(newDocuments, async (chunk) =>
          (await db.insert(schema.sstDocuments).values(chunk).onConflictDoNothing().returning({ id: schema.sstDocuments.id })).length,
        )
        inserted += await insertBatch(newVersions, async (chunk) =>
          (await db.insert(schema.sstDocumentVersions).values(chunk).onConflictDoNothing().returning({ id: schema.sstDocumentVersions.id })).length,
        )
      } else {
        skipped += newDocuments.length + newVersions.length
      }
    } else {
      skipped += 7
    }

    const ackVersions = versionCount < 12
      ? await db.select().from(schema.sstDocumentVersions).limit(20)
      : versions
    const ackCount = await countRows(sql, "sst_document_acks")
    if (ackCount < 20 && ackVersions.length > 0 && users.length > 0) {
      const acks: (typeof schema.sstDocumentAcknowledgments.$inferInsert)[] = []
      for (const version of ackVersions) {
        for (const user of users) {
          if (acks.length >= 20) break
          acks.push({
            id: devId("sst-ack", acks.length + 1, 6),
            versionId: version.id,
            userId: user.id,
            method: "digital",
            signature: "Acuse de demostración del entorno de desarrollo.",
            ip: null,
            userAgent: null,
            acknowledgedAt: iso(daysAgo(today, int(rng, 1, 30))),
          })
        }
        if (acks.length >= 20) break
      }
      if (apply) {
        inserted += await insertBatch(acks, async (chunk) =>
          (await db.insert(schema.sstDocumentAcknowledgments).values(chunk).onConflictDoNothing().returning({ id: schema.sstDocumentAcknowledgments.id })).length,
        )
      } else {
        skipped += acks.length
      }
    } else {
      skipped += 20
    }

    const distributionCount = await countRows(sql, "sst_document_distribution_targets")
    if (distributionCount < 10 && ackVersions.length > 0 && users.length > 0) {
      const targets: (typeof schema.sstDocumentDistributionTargets.$inferInsert)[] = []
      for (const version of ackVersions) {
        for (const user of users) {
          if (targets.length >= 10) break
          targets.push({
            id: devId("sst-distribution", targets.length + 1, 6),
            versionId: version.id,
            userId: user.id,
            workerId: null,
            assignmentReason: "Distribución de demostración.",
            worksiteId: base.worksites[targets.length % base.worksites.length]?.id ?? null,
            positionSnapshot: null,
            companySnapshot: "Chome",
            assignedByUserId: actors.adminUserId,
            assignedAt: iso(daysAgo(today, 20)),
            dueAt: iso(daysAgo(today, -10)),
            status: "pendiente",
            exemptedByUserId: null,
            exemptedAt: null,
            exemptionReason: null,
            lastReminderAt: null,
            reminderCount: 0,
            createdAt: iso(daysAgo(today, 20)),
            updatedAt: iso(daysAgo(today, 20)),
          })
        }
        if (targets.length >= 10) break
      }
      if (apply) {
        inserted += await insertBatch(targets, async (chunk) =>
          (await db.insert(schema.sstDocumentDistributionTargets).values(chunk).onConflictDoNothing().returning({ id: schema.sstDocumentDistributionTargets.id })).length,
        )
      } else {
        skipped += targets.length
      }
    } else {
      skipped += 10
    }
  } else {
    notes.push("No hay categorías de documentos SST; se omiten documentos y acuses.")
    skipped += 12
  }

  log(`  prevención: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "prevencion", inserted, skipped, notes }
}
