/**
 * Alertas del flujo MIPER y del barrido diario (§9.1, Tasks 3 y 5 de la F3).
 *
 * Dos cosas se prueban acá y las dos son reglas duras, no detalles:
 *
 * 1. **Nada sale dentro de la transacción.** Los destinatarios se resuelven con
 *    `getUserIdsWithPermissionForWorksite`, que consulta la conexión global
 *    `db`; hacerlo dentro del callback de una transacción con PGlite (una sola
 *    conexión) cuelga la suite, y en producción deja el aviso emitido antes del
 *    COMMIT, fuera del alcance de un ROLLBACK. Cada resolución de destinatarios
 *    queda registrada con el número de transacciones abiertas en ese instante y
 *    la aserción es que todas fueron fuera de una.
 * 2. **Deduplicación**: una fila que vuelve a Intolerable no avisa dos veces, y
 *    una ocurrencia vencida tampoco (`notifications_user_dedupe_unique`).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/** Lo que el test necesita ver: quiénes y desde dónde se avisó. */
const spy = vi.hoisted(() => ({
  /** Transacciones abiertas en este instante (ver el Proxy más abajo). */
  openTransactions: 0,
  recipientLookups: [] as Array<{ permission: string; worksiteId: string; openTransactions: number }>,
  notifications: [] as Array<{ userIds: string[]; type: string; dedupeKey: string | null }>,
}))

vi.mock("@/lib/services/notification-targeting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notification-targeting")>()
  return {
    ...actual,
    getUserIdsWithPermissionForWorksite: async (permission: string, worksiteId: string) => {
      spy.recipientLookups.push({ permission, worksiteId, openTransactions: spy.openTransactions })
      return actual.getUserIdsWithPermissionForWorksite(permission, worksiteId)
    },
  }
})

vi.mock("@/lib/services/notification-create", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notification-create")>()
  return {
    ...actual,
    notifyManyUser: async (userIds: string[], input: Parameters<typeof actual.notifyManyUser>[1]) => {
      spy.notifications.push({ userIds: [...userIds], type: input.type, dedupeKey: input.dedupeKey ?? null })
      return actual.notifyManyUser(userIds, input)
    },
  }
})

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }

/* El Proxy sólo envuelve `transaction` para saber cuántas hay abiertas: es la
 * evidencia de que ningún aviso se resolvió dentro de una. Cualquier otra
 * propiedad pasa tal cual al cliente real. */
g.__db = new Proxy(testDb as unknown as Record<PropertyKey, unknown>, {
  get(target, property, receiver) {
    if (property === "transaction") {
      return async (run: (tx: unknown) => Promise<unknown>) => {
        spy.openTransactions += 1
        try {
          return await (target as unknown as DB).transaction(run as never)
        } finally {
          spy.openTransactions -= 1
        }
      }
    }
    return Reflect.get(target, property, receiver)
  },
}) as unknown as DB

const WS = "ws-n"
const scope = { mode: "some" as const, ids: [WS] }
const all = { mode: "all" as const, ids: [] as [] }
const author = { userId: "u-autora", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review", "prevention:risk:edit"] }
const legal = { userId: "u-legal", scope: all, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }

const { createMiper, updateMiperHeader } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const obs = await import("@/lib/services/miper/observations")
const workflow = await import("@/lib/services/miper/workflow")
const { runMiperOccurrenceSweep } = await import("@/lib/services/miper/reminders")

/**
 * Los avisos salen en un microtask post-commit y cada uno resuelve
 * destinatarios y escribe contra la base: drenar la cola es dejar correr esos
 * ciclos, no esperar un tiempo arbitrario.
 */
async function drainPostCommit(ticks = 50) {
  for (let tick = 0; tick < ticks; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/* La base es una sola para todo el archivo (una instancia de PGlite): lo que se
 * limpia entre pruebas es el registro de *llamadas*, no los datos. */
beforeEach(() => {
  spy.notifications = []
  spy.recipientLookups = []
  spy.openTransactions = 0
})

async function notificationsOfType(type: string, dedupeKey?: string) {
  return testDb.select().from(schema.notifications).where(dedupeKey
    ? and(eq(schema.notifications.type, type), eq(schema.notifications.dedupeKey, dedupeKey))
    : eq(schema.notifications.type, type))
}

async function matrixRow(matrixId: string) {
  const [row] = await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
  return row!
}

async function freshMatrix(period: number) {
  const { id } = await createMiper({ worksiteId: WS, period, revisionReason: "Período para probar las alertas del flujo MIPER." }, author)
  return id
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena N", code: "N" })
  await testDb.insert(schema.users).values([
    { id: "u-autora", name: "Autora MIPER", email: "autora@n.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-prev", name: "Prevencionista de faena", email: "prev@n.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-jefa", name: "Jefa de Prevención", email: "jefa@n.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-legal", name: "Gerencia Legal y RRHH", email: "legal@n.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
    { id: "u-responsable", name: "Responsable de actividad", email: "resp@n.cl", hashedPassword: "x", isActive: true, emailNotifications: false },
  ])
  await testDb.insert(schema.permissions).values([
    { id: "perm-edit", name: "prevention:risk:edit", description: null, module: "prevention" },
    { id: "perm-review", name: "prevention:risk:review", description: null, module: "prevention" },
    { id: "perm-legal", name: "prevention:risk:approve_legal", description: null, module: "prevention" },
  ])
  await testDb.insert(schema.userPermissions).values([
    { userId: "u-autora", permissionId: "perm-edit" },
    { userId: "u-prev", permissionId: "perm-edit" },
    { userId: "u-jefa", permissionId: "perm-review" },
    { userId: "u-legal", permissionId: "perm-legal" },
  ])
  await testDb.insert(schema.worksiteUsers).values([
    { userId: "u-autora", worksiteId: WS },
    { userId: "u-prev", worksiteId: WS },
    { userId: "u-jefa", worksiteId: WS },
    { userId: "u-legal", worksiteId: WS },
    { userId: "u-responsable", worksiteId: WS },
  ])
}, 60_000)

/* ── Fila que pasa a Intolerable (§9.1) ──────────────────────────────────── */

describe("fila que pasa a Intolerable", () => {
  it("avisa al prevencionista de la faena y a la Jefa, una sola vez por fila", async () => {
    const matrixId = await freshMatrix(2031)
    const entry = await entries.saveMiperEntry({ matrixId, values: { hazard: "Camión en pendiente" } }, author)
    // Una fila incompleta no cruza ningún umbral: no hay nada que avisar.
    expect(spy.notifications).toHaveLength(0)

    await entries.saveMiperEntry({ matrixId, entryId: entry.id, expectedVersion: 1, values: { probability: 4, consequence: 4 } }, author)

    /* Ni la notificación ni su correo se arman antes de que la transacción
     * cierre: el thunk recién empieza a resolver destinatarios cuando el
     * llamador cedió el control. */
    expect(spy.notifications).toHaveLength(0)

    await drainPostCommit()
    expect(spy.recipientLookups.length).toBeGreaterThan(0)
    expect(spy.recipientLookups.every((lookup) => lookup.openTransactions === 0)).toBe(true)
    expect(spy.recipientLookups.map((lookup) => lookup.permission).sort()).toEqual([
      "prevention:risk:edit", "prevention:risk:review",
    ])
    expect(spy.recipientLookups.every((lookup) => lookup.worksiteId === WS)).toBe(true)

    const notes = await notificationsOfType("miper_row_intolerable")
    // El autor (que tiene el permiso de edición) no se avisa a sí mismo.
    expect(notes.map((note) => note.userId).sort()).toEqual(["u-jefa", "u-prev"])
    expect(notes.every((note) => note.dedupeKey === `miper-row-intolerable:${entry.id}`)).toBe(true)
    expect(notes.every((note) => note.entityId === matrixId)).toBe(true)
    expect(notes.every((note) => note.entityHref === `/prevencion/miper/${matrixId}?fila=${entry.id}`)).toBe(true)
  })

  it("no vuelve a avisar si la fila sale y entra otra vez a Intolerable (dedupe por fila)", async () => {
    const matrixId = await freshMatrix(2030)
    const entry = await entries.saveMiperEntry({ matrixId, values: { hazard: "Trabajo en altura", probability: 4, consequence: 4 } }, author)
    await drainPostCommit()
    expect(spy.notifications.filter((call) => call.type === "miper_row_intolerable")).toHaveLength(1)

    // Sale del umbral y vuelve a entrar: es el mismo hecho y la misma fila.
    await entries.saveMiperEntry({ matrixId, entryId: entry.id, expectedVersion: 1, values: { probability: 2, consequence: 2 } }, author)
    await entries.saveMiperEntry({ matrixId, entryId: entry.id, expectedVersion: 2, values: { probability: 4, consequence: 4 } }, author)
    // Y una edición que la deja igual de Intolerable tampoco avisa.
    await entries.saveMiperEntry({ matrixId, entryId: entry.id, expectedVersion: 3, values: { risk: "otra descripción" } }, author)
    await drainPostCommit()

    const notes = await notificationsOfType("miper_row_intolerable", `miper-row-intolerable:${entry.id}`)
    expect(notes.map((note) => note.userId).sort()).toEqual(["u-jefa", "u-prev"])
  })
})

/* ── Pasos del flujo: enviado, devuelto, pendiente de firma (§9.1) ───────── */

async function completeFlowMatrix(period: number) {
  const matrixId = await freshMatrix(period)
  const matrix = await matrixRow(matrixId)
  await updateMiperHeader({
    matrixId, expectedVersion: matrix.version, iperCode: "RE-04", elaboratedOn: `${period}-01-10`, updatedOn: null,
    companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
    adherentNumber: null, worksiteName: "Faena N", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
    headcountTotal: 5, headcountMale: 4, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
  }, author)
  const entry = await entries.saveMiperEntry({
    matrixId,
    values: {
      activity: "Transporte", task: "Descarga", position: "Conductor", riskFactorId: "riskfactor-mecanico",
      hazard: "Camión en pendiente", risk: "Volcamiento", probableDamage: "Politraumatismo",
      probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true,
    },
  }, author)
  const control = await entries.saveMiperControl({
    matrixId, entryId: entry.id,
    values: { hierarchy: "administrative", description: "Procedimiento de descarga en pendiente", responsibleName: "Supervisor", dueDate: `${period}-06-30` },
  }, author)
  return { matrixId, entryId: entry.id, controlId: control.id }
}

describe("pasos del flujo", () => {
  it("avisa al siguiente responsable y por cada ronda, no una vez por matriz", async () => {
    const { matrixId, entryId, controlId } = await completeFlowMatrix(2032)

    // Enviado → la Jefa (revisión técnica). El autor no se avisa a sí mismo.
    let matrix = await matrixRow(matrixId)
    await workflow.submitMiperForReview({ matrixId, expectedVersion: matrix.version }, author)
    await drainPostCommit()
    let pending = await notificationsOfType("miper_review_pending")
    expect(pending.map((note) => note.userId)).toEqual(["u-jefa"])
    const firstKey = pending[0]!.dedupeKey
    expect(firstKey).toMatch(new RegExp(`^miper-review-pendiente:${matrixId}:riskround-`))

    // Devuelto con observaciones → vuelve a quien editó.
    await obs.addMiperObservation({ matrixId, entryId, body: "Revisar la consecuencia del riesgo: el daño probable indica severidad alta." }, jefa)
    matrix = await matrixRow(matrixId)
    await workflow.returnMiperWithObservations({ matrixId, expectedVersion: matrix.version, comment: "Revisar la consecuencia del riesgo." }, jefa)
    await drainPostCommit()
    const returned = await notificationsOfType("miper_review_returned")
    expect(returned.map((note) => note.userId)).toEqual(["u-autora"])

    // Reenviado: una ronda nueva es un paso nuevo, con su propia llave.
    const observations = await testDb.select().from(schema.preventionRiskObservations).where(eq(schema.preventionRiskObservations.matrixId, matrixId))
    await obs.respondMiperObservation({ observationId: observations[0]!.id, response: "Se revisó: probabilidad alta, consecuencia alta." }, author)
    const [entryRow] = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, entryId))
    // La fila cruza a Intolerable: el reenvío exige su medida dentro del programa.
    await entries.saveMiperEntry({ matrixId, entryId, expectedVersion: entryRow!.version, values: { probability: 4, consequence: 4 } }, author)
    const { saveProgramAction, linkActionControls } = await import("@/lib/services/miper/program")
    const action = await saveProgramAction({ matrixId, description: "Procedimiento de descarga en pendiente", scheduleKind: "monthly", startsOn: "2032-03-01" }, author)
    const [programRow] = await testDb.select().from(schema.preventionRiskPrograms).where(eq(schema.preventionRiskPrograms.matrixId, matrixId))
    await linkActionControls({ programId: programRow!.id, actionId: action.id, controlIds: [controlId], link: true }, author)
    matrix = await matrixRow(matrixId)
    await workflow.submitMiperForReview({ matrixId, expectedVersion: matrix.version }, author)
    await drainPostCommit()

    pending = await notificationsOfType("miper_review_pending")
    expect(pending.map((note) => note.userId)).toEqual(["u-jefa", "u-jefa"])
    expect(new Set(pending.map((note) => note.dedupeKey)).size).toBe(2)
    expect(pending[1]!.dedupeKey).not.toBe(firstKey)

    // Aprobado técnicamente → pendiente de firma de Legal y RRHH.
    matrix = await matrixRow(matrixId)
    await workflow.approveMiperTechnicalReview({ matrixId, expectedVersion: matrix.version }, jefa)
    await drainPostCommit()
    const signature = await notificationsOfType("miper_signature_pending")
    expect(signature.map((note) => note.userId)).toEqual(["u-legal"])
    expect(signature[0]!.dedupeKey).toMatch(new RegExp(`^miper-firma-pendiente:${matrixId}:riskround-`))

    // Legal y RRHH devuelve: el aviso vuelve a quien elaboró.
    await obs.addMiperObservation({ matrixId, entryId, body: "Falta identificar al responsable del procedimiento." }, legal)
    matrix = await matrixRow(matrixId)
    await workflow.requestMiperCorrections({ matrixId, expectedVersion: matrix.version, comment: "Completar responsables antes de aprobar." }, legal)
    await drainPostCommit()
    expect((await notificationsOfType("miper_review_returned")).map((note) => note.userId).sort())
      .toEqual(["u-autora", "u-autora"])

    // Ningún aviso del flujo salió con una transacción abierta.
    expect(spy.recipientLookups.every((lookup) => lookup.openTransactions === 0)).toBe(true)
  }, 60_000)
})

/* ── Barrido diario: ocurrencia vencida y «No se hizo» (§9.1) ────────────── */

describe("barrido diario de ocurrencias", () => {
  it("avisa la vencida al responsable y al prevencionista, y la «No se hizo» a la Jefa; la segunda corrida no repite", async () => {
    const matrixId = await freshMatrix(2033)
    await testDb.insert(schema.preventionRiskPrograms).values({
      id: "prog-sweep", matrixId, worksiteId: WS, period: 2033, createdByUserId: "u-autora",
    })
    await testDb.insert(schema.preventionRiskProgramActions).values({
      id: "act-sweep", programId: "prog-sweep", actionNumber: 1, description: "Inspección mensual de extintores",
      responsibleUserId: "u-responsable", scheduleKind: "monthly", startsOn: "2033-01-01", createdByUserId: "u-autora",
    })
    await testDb.insert(schema.preventionRiskProgramOccurrences).values([
      { id: "occ-vencida", actionId: "act-sweep", dueOn: "2020-01-15", outcome: "pending" },
      { id: "occ-no-hecha", actionId: "act-sweep", dueOn: "2020-02-15", outcome: "not_done" },
      // Ya registrada: no es un vencimiento, el flujo la ve en línea.
      { id: "occ-hecha", actionId: "act-sweep", dueOn: "2020-03-15", outcome: "done" },
    ])

    const first = await runMiperOccurrenceSweep()
    expect(first).toMatchObject({ overdue: 1, overdueNotified: 1, notDone: 1, notDoneNotified: 1, notifiedUsers: 4 })

    const overdue = await notificationsOfType("miper_occurrence_overdue")
    // Responsable nominal + quienes pueden editar la matriz de esa faena.
    expect(overdue.map((note) => note.userId).sort()).toEqual(["u-autora", "u-prev", "u-responsable"])
    expect(overdue.every((note) => note.dedupeKey === "miper-occurrence-vencida:occ-vencida")).toBe(true)

    const notDone = await notificationsOfType("miper_occurrence_not_done")
    expect(notDone.map((note) => note.userId)).toEqual(["u-jefa"])
    expect(notDone[0]!.dedupeKey).toBe("miper-occurrence-no-hecha:occ-no-hecha")
    expect(notDone[0]!.entityHref).toBe(`/prevencion/miper/${matrixId}?tab=programa&ocurrencia=occ-no-hecha`)

    // Idempotente: la clave va por ocurrencia, no por día.
    const again = await runMiperOccurrenceSweep()
    expect(again).toMatchObject({ overdue: 1, overdueNotified: 0, notDone: 1, notDoneNotified: 0, notifiedUsers: 0 })

    // El cron no abre transacción: sólo lee y notifica.
    expect(spy.recipientLookups.every((lookup) => lookup.openTransactions === 0)).toBe(true)
    expect(spy.recipientLookups.some((lookup) => lookup.permission === "prevention:risk:review" && lookup.worksiteId === WS && lookup.openTransactions === 0)).toBe(true)
  })
})

/* El índice único parcial `notifications_user_dedupe_unique` es lo que hace
 * posible todo lo de arriba: si la base admitiera dos filas con la misma
 * `(userId, dedupeKey)`, la deduplicación dependería de leer antes de escribir
 * —una carrera— en vez de de la base. */
it("ninguna persona quedó con la misma llave de deduplicación dos veces", async () => {
  const rows = await testDb.select({ userId: schema.notifications.userId, dedupeKey: schema.notifications.dedupeKey }).from(schema.notifications)
  const keys = rows.filter((row) => row.dedupeKey).map((row) => `${row.userId}::${row.dedupeKey}`)
  expect(keys.length).toBeGreaterThan(0)
  expect(new Set(keys).size).toBe(keys.length)
})
