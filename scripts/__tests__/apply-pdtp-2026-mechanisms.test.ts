/**
 * scripts/__tests__/apply-pdtp-2026-mechanisms.test.ts
 *
 * Task 15: el programa PDTP 2026 real está firmado (v1 `closed`, v2 `active`,
 * sin ninguna revisión `draft` abierta), así que `apply-pdtp-2026-mechanisms.ts`
 * dejaba la reclasificación de la N°20 detectada pero nunca aplicada. Este test
 * cubre el flujo completo del script (`runMechanismsPass`) sobre un programa
 * activo firmado con un cambio de mecanismo pendiente: debe abrir —o reutilizar
 * si ya existe— una revisión v+1 y aplicar ahí el cambio, sin tocar el activo.
 *
 * `@/db` se evalúa antes de que `testGlobal.__db` quede asignado si se importa
 * estáticamente arriba (mismo cuidado que `pdtp-objectives.test.ts` y
 * `apply-pdtp-2026-objectives.test.ts`), así que tanto el script como el
 * servicio se importan dinámicamente dentro de cada test/helper.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  // Borrar `pdtp_programs` cascadea a `pdtp_activities`, `pdtp_approval_steps`
  // y el resto de las tablas program-scoped (mismo comentario que
  // `deletePdtpProgram` en `lib/services/pdtp/programs.ts`).
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  // Evita depender del fallback a "primer administrador": la resolución del
  // actor se cubre por su propio patrón en apply-pdtp-2026-program-data.ts.
  process.env.PDTP_MECHANISMS_ACTOR_USER_ID = "user-1"
})

afterEach(() => {
  delete process.env.PDTP_MECHANISMS_ACTOR_USER_ID
  delete process.env.PDTP_MECHANISMS_DEPLOY_MODE
})

/** Señuelo para simular que `process.exit()` corta la ejecución, sin matar el worker de test. */
class ProcessExitSignal extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

const N20_ID = (programId: string) => `${programId}-a-020`

/** Actividad N°20 mínima, con el mecanismo que se le pase. */
async function insertActivityN20(programId: string, mechanism: "constancia" | "enganche") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: N20_ID(programId),
    programId,
    n: 20,
    status: "active",
    mechanism,
    displayOrder: 20,
    activity: "Reunión de coordinación con la empresa mandante",
    program: "Guía de ejecución",
    responsibleSlugs: [],
    responsibleDisplay: "Prevencionista",
    sourceSheetRow: 20,
    createdAt: now,
    updatedAt: now,
  })
}

describe("apply-pdtp-2026-mechanisms (PGlite): programa 2026 firmado", () => {
  it("abre (o reutiliza) una revisión v+1 y aplica ahí el mecanismo pendiente, sin tocar el programa activo", async () => {
    const { runMechanismsPass } = await import("../apply-pdtp-2026-mechanisms")
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")

    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa 2026", userId: "user-1" })
    // La N°20 salió de CONSTANCIA hacia ENGANCHE (Task 12); acá simula que el
    // programa quedó firmado antes de que esa reclasificación se aplicara.
    await insertActivityN20(program.id, "constancia")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    const first = await runMechanismsPass()
    if (first.kind !== "applied_in_revision") throw new Error(`esperaba "applied_in_revision", llegó "${first.kind}"`)
    expect(first.sourceProgramId).toBe(program.id)
    expect(first.applied).toBe(1)

    // El programa activo/firmado no se tocó: ni su status ni el mecanismo de
    // su propia actividad N°20 cambiaron.
    const [activeProgramRow] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))
    expect(activeProgramRow?.status).toBe("active")
    const [activeActivity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, N20_ID(program.id)))
    expect(activeActivity?.mechanism).toBe("constancia")

    // La revisión nueva quedó en `draft`, referida al activo, con la N°20 ya
    // corregida — y conservando el `status = "active"` clonado del origen.
    const [revisionProgram] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, first.revisionProgramId))
    expect(revisionProgram?.status).toBe("draft")
    expect(revisionProgram?.sourceProgramId).toBe(program.id)
    expect(revisionProgram?.approvedByJdprUserId).toBeNull()
    expect(revisionProgram?.approvedByLegalUserId).toBeNull()

    const [revisionActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, first.revisionProgramId), eq(schema.pdtpActivities.n, 20)))
    expect(revisionActivity?.mechanism).toBe("enganche")
    expect(revisionActivity?.status).toBe("active")

    // Segunda corrida: la selección de programa del script es "draft primero"
    // (preexistente a esta tarea, ver el comentario sobre `orderedPrograms` en
    // `runMechanismsPass`), así que ahora elige directo la revisión recién
    // abierta —ya editable y ya con el mecanismo correcto— en vez de volver a
    // pasar por el camino "programa bloqueado". Escribe ahí mismo sin abrir
    // una segunda revisión y sin cambiar nada, porque ya está aplicado.
    const second = await runMechanismsPass()
    if (second.kind !== "applied_directly") throw new Error(`esperaba "applied_directly", llegó "${second.kind}"`)
    expect(second.programId).toBe(first.revisionProgramId)
    expect(second.applied).toBe(0)

    const programsForYear = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.year, 2026))
    // v1 (activo, firmado) + v2 (la revisión) — nunca una v3 de una segunda corrida.
    expect(programsForYear).toHaveLength(2)
    expect(programsForYear.map((p) => p.version).sort()).toEqual([1, 2])
  })

  it("no abre ninguna revisión cuando el programa está bloqueado pero no hay clasificaciones pendientes", async () => {
    const { runMechanismsPass } = await import("../apply-pdtp-2026-mechanisms")
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")

    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa 2026", userId: "user-1" })
    await insertActivityN20(program.id, "enganche") // ya correcto
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    const result = await runMechanismsPass()
    expect(result).toEqual({ kind: "locked_no_pending_changes", programId: program.id })

    const programsForYear = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.year, 2026))
    expect(programsForYear).toHaveLength(1)
  })

  it("escribe directo, sin abrir ninguna revisión, cuando el programa elegido es un draft editable", async () => {
    const { runMechanismsPass } = await import("../apply-pdtp-2026-mechanisms")
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")

    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa 2026", userId: "user-1" })
    await insertActivityN20(program.id, "constancia")
    // El programa sigue en `draft`: es editable, así que la escritura va directo.

    const result = await runMechanismsPass()
    expect(result).toEqual({ kind: "applied_directly", programId: program.id, applied: 1 })

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, N20_ID(program.id)))
    expect(activity?.mechanism).toBe("enganche")

    const programsForYear = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.year, 2026))
    expect(programsForYear).toHaveLength(1)
  })

  it("no escribe sobre una revisión v+1 ya reutilizada que sigue en proceso de revisión formal (bail sin lanzar en modo deploy)", async () => {
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
    const { pdtpProgramId } = await import("@/lib/services/pdtp/helpers")

    const program = await createLegacyPdtpProgramForTests({ year: 2026, title: "Programa 2026", userId: "user-1" })
    await insertActivityN20(program.id, "constancia")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    // Simula una revisión v+1 YA existente y abierta por un humano (no por
    // este script) que YA sometió esa revisión a proceso formal
    // (`reviewStartedAt` seteado) — `assertPdtpProgramEditableState` la trata
    // como bloqueada aunque su `status` siga en "draft". `createPdtpRevision`
    // la encuentra y la reutiliza porque su `status` está en
    // ["draft", "in_review"]; el bug era que el script escribía encima sin
    // comprobar nada de esto.
    const revisionId = pdtpProgramId(2026, 2)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: revisionId,
      year: 2026,
      version: 2,
      status: "draft",
      title: program.title,
      sourceProgramId: program.id,
      reviewStartedAt: now,
      elaboratedByUserId: "user-1",
      elaboratedByName: "U1",
      elaboratedByTitle: "Prevencionista",
      createdAt: now,
      updatedAt: now,
    })
    // Clon con el mismo mecanismo pendiente que el activo: la reclasificación
    // de la N°20 (constancia → enganche) sigue sin aplicarse en la revisión.
    await insertActivityN20(revisionId, "constancia")

    // `DEPLOY_MODE` es una constante de módulo (`process.env.…​ === "true"`
    // leída una sola vez al cargar `apply-pdtp-2026-mechanisms.ts`), y los
    // tests anteriores ya lo importaron sin la env var puesta. Hace falta
    // `vi.resetModules()` para forzar una reevaluación fresca — mismo patrón
    // que `lib/__tests__/env.test.ts` y las suites *-postgres.test.ts que
    // reimportan un servicio después de `resetModules()` (p. ej.
    // `prevention-cgrd-postgres.test.ts`). `testGlobal.__db` sigue seteado
    // (es un global, `resetModules()` no lo toca), así que el módulo fresco
    // de `@/db` sigue resolviendo a la misma conexión PGlite.
    process.env.PDTP_MECHANISMS_DEPLOY_MODE = "true"
    vi.resetModules()
    const { runMechanismsPass } = await import("../apply-pdtp-2026-mechanisms")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExitSignal(code)
    }) as never)

    try {
      await expect(runMechanismsPass()).rejects.toBeInstanceOf(ProcessExitSignal)
      // Modo deploy: se advierte y se corta (exit 0), nunca se lanza sin capturar.
      expect(exitSpy).toHaveBeenCalledWith(0)
      const warned = warnSpy.mock.calls.map((call) => String(call[0]))
      expect(warned.some((msg) => msg.includes(revisionId) && msg.includes("revisión formal"))).toBe(true)
    } finally {
      exitSpy.mockRestore()
      warnSpy.mockRestore()
    }

    // Nada se escribió sobre la revisión reutilizada.
    const [revisionActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(and(eq(schema.pdtpActivities.programId, revisionId), eq(schema.pdtpActivities.n, 20)))
    expect(revisionActivity?.mechanism).toBe("constancia")

    // Tampoco se creó una tercera revisión ni se tocó el activo/firmado.
    const programsForYear = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.year, 2026))
    expect(programsForYear).toHaveLength(2)
    const [activeProgramRow] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))
    expect(activeProgramRow?.status).toBe("active")
  })
})
