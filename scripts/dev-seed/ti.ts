import * as schema from "../../db/schema"
import {
  chance,
  countRows,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedTi(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  if (base.workers.length === 0) {
    return { domain: "ti", inserted: 0, skipped: 0, notes: ["No hay trabajadores activos; no se sembró TI."] }
  }

  // ── Sistemas de acceso ────────────────────────────────────────────────────
  const systemCount = await countRows(sql, "it_access_systems")
  const systems: (typeof schema.itAccessSystems.$inferInsert)[] = systemCount >= 2
    ? []
    : [
        { id: devId("it-system", 1), name: "Correo corporativo", description: "Cuenta de correo y calendario.", isActive: true },
        { id: devId("it-system", 2), name: "ERP de abastecimiento", description: "Acceso al sistema de compras y bodega.", isActive: true },
      ]
  if (systems.length > 0) {
    if (apply) {
      inserted += await insertBatch(systems, async (chunk) =>
        (await db.insert(schema.itAccessSystems).values(chunk).onConflictDoNothing().returning({ id: schema.itAccessSystems.id })).length,
      )
    } else {
      skipped += systems.length
    }
  } else {
    skipped += 2
  }
  const usableSystems = systemCount >= 2 ? await db.select().from(schema.itAccessSystems).limit(5) : systems

  // ── Accesos por trabajador ────────────────────────────────────────────────
  const accessCount = await countRows(sql, "it_system_access")
  if (accessCount < 6 && usableSystems.length > 0) {
    const rows: (typeof schema.itSystemAccess.$inferInsert)[] = []
    for (const [systemIndex, system] of usableSystems.entries()) {
      for (const [workerIndex, worker] of base.workers.slice(0, 6).entries()) {
        rows.push({
          id: devId("it-access", systemIndex * 100 + workerIndex + 1, 6),
          systemId: system.id,
          workerId: worker.id,
          status: chance(rng, 0.15) ? "suspendido" : "activo",
          grantedAt: iso(daysAgo(today, int(rng, 10, 200))),
          revokedAt: null,
          responsibleUserId: actors.adminUserId,
          notes: "Acceso de demostración.",
          createdAt: iso(daysAgo(today, int(rng, 10, 200))),
          updatedAt: iso(daysAgo(today, int(rng, 1, 30))),
        })
      }
    }
    if (apply) {
      inserted += await insertBatch(rows, async (chunk) =>
        (await db.insert(schema.itSystemAccess).values(chunk).onConflictDoNothing().returning({ id: schema.itSystemAccess.id })).length,
      )
    } else {
      skipped += rows.length
    }
  } else {
    skipped += 6
  }

  // ── Checklists de alta y baja ─────────────────────────────────────────────
  const checklistCount = await countRows(sql, "it_worker_checklists")
  if (checklistCount < 2) {
    const checklists: (typeof schema.itWorkerChecklists.$inferInsert)[] = base.workers.slice(0, 2).flatMap((worker, index) => [
      {
        id: devId("it-checklist-onboarding", index + 1),
        workerId: worker.id,
        kind: "onboarding",
        startedAt: iso(daysAgo(today, 30 + index)),
        completedAt: iso(daysAgo(today, 25 + index)),
        createdByUserId: actors.adminUserId,
        notes: "Checklist de alta de demostración.",
        createdAt: iso(daysAgo(today, 30 + index)),
      },
      {
        id: devId("it-checklist-offboarding", index + 1),
        workerId: worker.id,
        kind: "offboarding",
        startedAt: iso(daysAgo(today, 10 + index)),
        completedAt: null,
        createdByUserId: actors.adminUserId,
        notes: "Checklist de baja de demostración.",
        createdAt: iso(daysAgo(today, 10 + index)),
      },
    ])
    const tasks: (typeof schema.itChecklistTasks.$inferInsert)[] = checklists.flatMap((checklist, checklistIndex) =>
      [
        "Crear cuenta de correo",
        "Asignar equipo computacional",
        "Registrar accesos a sistemas",
        "Entregar credenciales de forma segura",
        "Firmar acta de entrega",
      ].map((name, position) => ({
        id: devId("it-checklist-task", checklistIndex * 100 + position + 1, 6),
        checklistId: checklist.id!,
        name,
        position,
        done: checklistIndex % 2 === 0 ? position < 3 : position < 1,
        doneAt: checklistIndex % 2 === 0 && position < 3 ? iso(daysAgo(today, 20)) : null,
        doneByUserId: checklistIndex % 2 === 0 && position < 3 ? actors.adminUserId : null,
        notes: null,
      })),
    )
    if (apply) {
      inserted += await insertBatch(checklists, async (chunk) =>
        (await db.insert(schema.itWorkerChecklists).values(chunk).onConflictDoNothing().returning({ id: schema.itWorkerChecklists.id })).length,
      )
      inserted += await insertBatch(tasks, async (chunk) =>
        (await db.insert(schema.itChecklistTasks).values(chunk).onConflictDoNothing().returning({ id: schema.itChecklistTasks.id })).length,
      )
    } else {
      skipped += checklists.length + tasks.length
    }
  } else {
    skipped += 2
  }

  // ── Asignaciones de licencias ─────────────────────────────────────────────
  const [activeAssignments] = await sql`select count(*)::int as n from it_license_assignments where revoked_at is null`
  const assignmentCount = Number(activeAssignments?.n ?? 0)
  const licenses = await db.select().from(schema.itLicenses).limit(10)
  const assets = await db.select({ id: schema.itAssets.id, worksiteId: schema.itAssets.worksiteId }).from(schema.itAssets).limit(10)
  if (assignmentCount < 5 && licenses.length > 0) {
    const assignments: (typeof schema.itLicenseAssignments.$inferInsert)[] = Array.from({ length: 5 }, (_, index) => ({
      id: devId("it-license-assignment", index + 1),
      licenseId: licenses[index % licenses.length]!.id,
      workerId: base.workers[index % base.workers.length]?.id ?? null,
      assetId: assets[index % Math.max(assets.length, 1)]?.id ?? null,
      area: null,
      worksiteId: base.worksites[index % base.worksites.length]?.id ?? null,
      assignedAt: iso(daysAgo(today, int(rng, 5, 120))),
      revokedAt: null,
      notes: "Asignación de demostración.",
    }))
    if (apply) {
      inserted += await insertBatch(assignments, async (chunk) =>
        (await db.insert(schema.itLicenseAssignments).values(chunk).onConflictDoNothing().returning({ id: schema.itLicenseAssignments.id })).length,
      )
    } else {
      skipped += assignments.length
    }
  } else {
    skipped += 5
  }

  log(`  TI: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "ti", inserted, skipped, notes }
}
