/**
 * Fase 5 — asignación nominal de actividades del PDTP a personas, por faena.
 *
 * Lo que se fija acá es lo que no se puede mover sin romper la promesa de la
 * fase:
 *
 *  · los candidatos salen del rol responsable de la actividad y de sus
 *    ejecutores, acotados a la faena (o globales), y el servidor los revalida —
 *    no confía en que la UI haya ofrecido los correctos;
 *  · sacar a alguien CIERRA su vigencia (`valid_until = validFrom − 1 día`), no
 *    borra la fila: el historial de quién respondía en qué semana es lo que
 *    pregunta un fiscalizador;
 *  · asignar NO cambia la huella del programa. Si la cambiara, nombrar a un
 *    responsable abriría una revisión v+1 del documento firmado.
 *
 * PGlite propio: el fixture toca RBAC (roles, permisos, adscripción a faena) y
 * mezclarlo con otro archivo correría sus asserts.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

/**
 * El envío real manda correo; acá interesa A QUIÉN se le habría notificado. Se
 * intercepta sólo `createNotifications` y se deja intacta
 * `getUserIdsWithPermissionForWorksite`, que es la resolución por permiso y
 * faena que la fase tiene que seguir respetando cuando no hay asignado.
 */
const notified = vi.hoisted(() => [] as string[])
vi.mock("@/lib/services/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notifications")>()
  return {
    ...actual,
    createNotifications: async (userIds: string[]) => { notified.push(...userIds) },
  }
})

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const NOW = "2026-03-01T12:00:00.000Z"
const PROGRAM_ID = "prog-asg"
const WORKSITE_ID = "ws-asg"
const OTHER_WORKSITE_ID = "ws-asg-otra"
const ACTIVITY_ID = "act-asg"

beforeEach(async () => {
  notified.length = 0
  await inMemoryDb.delete(schema.notifications)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.worksites).values([
    { id: WORKSITE_ID, name: "Faena Asignación", code: "ASG", isActive: true },
    { id: OTHER_WORKSITE_ID, name: "Faena vecina", code: "ASG2", isActive: true },
  ])
  await inMemoryDb.insert(schema.users).values([
    { id: "u-ana", name: "Ana Jefa", email: "ana@asg", hashedPassword: "x", isActive: true },
    { id: "u-beto", name: "Beto Jefe", email: "beto@asg", hashedPassword: "x", isActive: true },
    // Mismo rol, otra faena: no es candidato acá.
    { id: "u-carla", name: "Carla Ajena", email: "carla@asg", hashedPassword: "x", isActive: true },
    // En la faena, pero con un rol que no responde por esta actividad.
    { id: "u-dario", name: "Darío Bodeguero", email: "dario@asg", hashedPassword: "x", isActive: true },
    // Rol global: opera todas las faenas, así que sí es candidato.
    { id: "u-elena", name: "Elena Global", email: "elena@asg", hashedPassword: "x", isActive: true },
    { id: "u-admin", name: "Quien asigna", email: "admin@asg", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.permissions).values({
    id: "perm-exec", name: "prevention:pdtp:execute", module: "prevention",
  })
  await inMemoryDb.insert(schema.roles).values([
    { id: "role-jt", name: "jefe_terreno", label: "Jefe de terreno", isGlobal: false },
    { id: "role-bod", name: "bodeguero", label: "Bodeguero", isGlobal: false },
    { id: "role-prev", name: "prevencionista", label: "Prevencionista", isGlobal: true },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "role-jt", permissionId: "perm-exec" },
    { roleId: "role-prev", permissionId: "perm-exec" },
  ])
  await inMemoryDb.insert(schema.userRoles).values([
    { userId: "u-ana", roleId: "role-jt" },
    { userId: "u-beto", roleId: "role-jt" },
    { userId: "u-carla", roleId: "role-jt" },
    { userId: "u-dario", roleId: "role-bod" },
    { userId: "u-elena", roleId: "role-prev" },
  ])
  await inMemoryDb.insert(schema.worksiteUsers).values([
    { userId: "u-ana", worksiteId: WORKSITE_ID, isPrimary: true },
    { userId: "u-beto", worksiteId: WORKSITE_ID, isPrimary: true },
    { userId: "u-carla", worksiteId: OTHER_WORKSITE_ID, isPrimary: true },
    { userId: "u-dario", worksiteId: WORKSITE_ID, isPrimary: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "jt", displayName: "Jefe de terreno", roleName: "jefe_terreno",
    kind: "rbac_role", isActive: true,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, year: 2026, version: 1, status: "active", title: "PDTP 2026",
    elaboratedByName: "Prevención", elaboratedByTitle: "PR",
    createdAt: NOW, updatedAt: NOW,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 7, activity: "Charla de seguridad",
    program: "Guía", responsibleSlugs: ["jt"], responsibleDisplay: "Jefe de terreno",
    scheduleMode: "scheduled", sourceSheetRow: 1, createdAt: NOW, updatedAt: NOW,
  })
})

async function service() {
  return import("@/lib/services/prevention-pdtp")
}

describe("listPdtpAssigneeCandidates", () => {
  it("ofrece a los de la faena con el rol responsable, y no a los de otra faena ni a otros roles", async () => {
    const { listPdtpAssigneeCandidates } = await service()
    const candidates = await listPdtpAssigneeCandidates(ACTIVITY_ID, WORKSITE_ID)
    expect(new Set(candidates.map((c) => c.userId))).toEqual(new Set(["u-ana", "u-beto", "u-elena"]))
  })

  it("muestra la etiqueta del rol, no su slug interno", async () => {
    const { listPdtpAssigneeCandidates } = await service()
    const candidates = await listPdtpAssigneeCandidates(ACTIVITY_ID, WORKSITE_ID)
    const ana = candidates.find((c) => c.userId === "u-ana")
    expect(ana?.roleLabels).toEqual(["Jefe de terreno"])
    expect(ana?.roleLabels).not.toContain("jefe_terreno")
  })

  it("los ejecutores acreditadores de la actividad también son candidatos", async () => {
    // El bodeguero no responde por la actividad, pero si se le asignó como
    // ejecutor acreditador de ella, puede recibirla.
    await inMemoryDb.insert(schema.pdtpActivityExecutorAssignments).values({
      id: "exec-bod", activityId: ACTIVITY_ID, roleId: "role-bod", createdAt: NOW, updatedAt: NOW,
    })
    const { listPdtpAssigneeCandidates } = await service()
    const candidates = await listPdtpAssigneeCandidates(ACTIVITY_ID, WORKSITE_ID)
    expect(candidates.map((c) => c.userId)).toContain("u-dario")
  })

  it("una cuenta desactivada deja de ser candidata", async () => {
    await inMemoryDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-beto"))
    const { listPdtpAssigneeCandidates } = await service()
    const candidates = await listPdtpAssigneeCandidates(ACTIVITY_ID, WORKSITE_ID)
    expect(candidates.map((c) => c.userId)).not.toContain("u-beto")
  })
})

describe("setPdtpActivityAssignees", () => {
  it("abre la vigencia del asignado y lo deja resuelto para la celda", async () => {
    const { setPdtpActivityAssignees, resolvePdtpAssigneesForCell } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    const resolved = await resolvePdtpAssigneesForCell(ACTIVITY_ID, WORKSITE_ID, "2026-03-15")
    expect(resolved).toEqual([{ userId: "u-ana", userName: "Ana Jefa" }])
  })

  it("no rige antes de su fecha de inicio", async () => {
    const { setPdtpActivityAssignees, resolvePdtpAssigneesForCell } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-04-01" },
      "u-admin", "all",
    )
    // Antes del 1 de abril la fila sigue siendo del rol completo: eso es lo que
    // impide que fijar una vigencia futura esconda trabajo hoy.
    await expect(resolvePdtpAssigneesForCell(ACTIVITY_ID, WORKSITE_ID, "2026-03-15")).resolves.toEqual([])
  })

  it("cierra la vigencia que sale y abre la nueva en vez de borrar el historial", async () => {
    const { setPdtpActivityAssignees, resolvePdtpAssigneesForCell } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-beto"], validFrom: "2026-06-01" },
      "u-admin", "all",
    )

    const rows = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees)
    expect(rows).toHaveLength(2)
    const ana = rows.find((row) => row.userId === "u-ana")
    const beto = rows.find((row) => row.userId === "u-beto")
    // `valid_until` = día anterior al inicio de la nueva: sin huecos ni solapes.
    expect(ana?.validUntil).toBe("2026-05-31")
    expect(beto?.validUntil).toBeNull()

    // La pregunta del fiscalizador: quién respondía en abril.
    await expect(resolvePdtpAssigneesForCell(ACTIVITY_ID, WORKSITE_ID, "2026-04-10"))
      .resolves.toEqual([{ userId: "u-ana", userName: "Ana Jefa" }])
    await expect(resolvePdtpAssigneesForCell(ACTIVITY_ID, WORKSITE_ID, "2026-06-10"))
      .resolves.toEqual([{ userId: "u-beto", userName: "Beto Jefe" }])
  })

  it("mantiene la vigencia original de quien sigue asignado", async () => {
    const { setPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana", "u-beto"], validFrom: "2026-06-01" },
      "u-admin", "all",
    )
    const rows = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.userId === "u-ana")?.validFrom).toBe("2026-03-01")
  })

  it("una corrección el mismo día borra el intento en vez de dejar una vigencia imposible", async () => {
    // `valid_until = valid_from − 1 día` caería antes del inicio y el CHECK de
    // la tabla lo rechaza. Una asignación que no llegó a regir un día completo
    // no tiene período de responsabilidad que conservar: lo que queda del
    // intento es la entrada del control de cambios.
    const { setPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-beto"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    const rows = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees)
    expect(rows.map((row) => row.userId)).toEqual(["u-beto"])
  })

  it("una lista vacía devuelve la actividad a la visibilidad por rol", async () => {
    const { setPdtpActivityAssignees, resolvePdtpAssigneesForCell } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: [], validFrom: "2026-06-01" },
      "u-admin", "all",
    )
    await expect(resolvePdtpAssigneesForCell(ACTIVITY_ID, WORKSITE_ID, "2026-06-10")).resolves.toEqual([])
  })

  it("rechaza a quien no está en la lista de candidatos, aunque la UI lo haya mandado", async () => {
    const { setPdtpActivityAssignees } = await service()
    await expect(setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-dario"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )).rejects.toThrow(/Darío Bodeguero/)
  })

  it("rechaza a quien tiene el rol correcto pero en otra faena", async () => {
    const { setPdtpActivityAssignees } = await service()
    await expect(setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-carla"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )).rejects.toThrow(/Carla Ajena/)
  })

  it("respeta el alcance de faenas de quien asigna", async () => {
    const { setPdtpActivityAssignees } = await service()
    await expect(setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", [OTHER_WORKSITE_ID],
    )).rejects.toThrow(/sin acceso a la faena/i)
  })

  it("deja rastro en el control de cambios del programa", async () => {
    const { setPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    const [entry] = await inMemoryDb.select().from(schema.pdtpChangeLog)
    expect(entry?.section).toBe("assignee:7")
    expect(entry?.note).toContain("Ana Jefa")
  })

  it("no cambia la huella de contenido del programa: asignar es operación, no contenido", async () => {
    const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")
    const before = await computePdtpProgramContentDigest(PROGRAM_ID)

    const { setPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana", "u-elena"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )

    const after = await computePdtpProgramContentDigest(PROGRAM_ID)
    expect(after.digest).toBe(before.digest)
  })
})

describe("listPdtpActivityAssignees", () => {
  it("responde a la fecha que se le pregunte, no sólo a hoy", async () => {
    const { setPdtpActivityAssignees, listPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-beto"], validFrom: "2026-06-01" },
      "u-admin", "all",
    )

    const enAbril = await listPdtpActivityAssignees(PROGRAM_ID, WORKSITE_ID, { asOf: "2026-04-10" })
    expect(enAbril.map((row) => row.userName)).toEqual(["Ana Jefa"])
    expect(enAbril[0]?.roleLabel).toBe("Jefe de terreno")

    const enJulio = await listPdtpActivityAssignees(PROGRAM_ID, WORKSITE_ID, { asOf: "2026-07-10" })
    expect(enJulio.map((row) => row.userName)).toEqual(["Beto Jefe"])
  })

  it("no mezcla faenas", async () => {
    const { setPdtpActivityAssignees, listPdtpActivityAssignees } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-03-01" },
      "u-admin", "all",
    )
    await expect(listPdtpActivityAssignees(PROGRAM_ID, OTHER_WORKSITE_ID, { asOf: "2026-03-15" }))
      .resolves.toEqual([])
  })
})

describe("recordatorio semanal", () => {
  beforeEach(async () => {
    // La membresía acota el programa a UNA faena: sin ella el programa aplica a
    // todas las del alcance y el recordatorio arrastraría también a los
    // responsables de la faena vecina, que no es lo que este caso mide.
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
      id: "pw-asg", programId: PROGRAM_ID, worksiteId: WORKSITE_ID, isActive: true, addedAt: NOW,
    })
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sch-asg", activityId: ACTIVITY_ID, year: 2026, month: 3, week: 2,
      plannedQuantity: 1, sourceColumn: "xlsx",
    })
  })

  it("sin asignado nominal avisa a todos los del permiso en la faena", async () => {
    const { runPdtpWeeklyReminders } = await service()
    await runPdtpWeeklyReminders({ year: 2026, month: 3, week: 2 })
    // `u-elena` entra por rol global; `u-dario` no tiene el permiso.
    expect(new Set(notified)).toEqual(new Set(["u-ana", "u-beto", "u-elena"]))
  })

  it("con asignado nominal el recordatorio va sólo al asignado", async () => {
    const { setPdtpActivityAssignees, runPdtpWeeklyReminders } = await service()
    await setPdtpActivityAssignees(
      { activityId: ACTIVITY_ID, worksiteId: WORKSITE_ID, userIds: ["u-ana"], validFrom: "2026-01-01" },
      "u-admin", "all",
    )
    await runPdtpWeeklyReminders({ year: 2026, month: 3, week: 2 })
    expect(new Set(notified)).toEqual(new Set(["u-ana"]))
  })
})
