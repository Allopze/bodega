/**
 * Grupo B de la auditoría 2026-08-16: seis puntos de Prevención medían el día
 * (o el año) en UTC en vez del calendario chileno.
 *
 * Todo este archivo corre con el reloj fijado a las **23:00 de Chile**, la
 * ventana en que UTC ya pasó al día siguiente y el bug se manifiesta. Cada
 * prueba deja anotado, como control, qué habría contestado el código viejo.
 *
 * Se fija sólo `Date` (`toFake: ["Date"]`): PGlite y el driver usan temporizadores
 * reales para resolver sus promesas, y congelarlos cuelga la suite.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { codeYear, todayInChile } from "@/lib/utils"

/* 23:00 en Chile con UTC ya en el día —y en el año— siguiente.
 * Verificado contra la base de datos de zonas horarias del runtime: en verano
 * austral Chile va en UTC-3 y en invierno en UTC-4, así que el instante UTC no
 * es el mismo desplazamiento en los tres casos. */
const NOCHEVIEJA = "2027-01-01T02:00:00Z"   // Chile: 2026-12-31 23:00 (UTC-3)
const AGOSTO = "2026-08-16T03:00:00Z"       // Chile: 2026-08-15 23:00 (UTC-4)
const FIN_DE_ENERO = "2026-02-01T02:00:00Z" // Chile: 2026-01-31 23:00 (UTC-3)

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { createChangeRequest } = await import("@/lib/services/prevention-change")
const { addEmergencyResource, createEmergencyPlan } = await import("@/lib/services/prevention-emergency")
const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
const { gatherCertificationEvidence } = await import("@/lib/services/prevention-cphs-certification")

const ALL: WorksiteScope = { mode: "all", ids: [] }
const ACCESS = {
  userId: "u-tz",
  scope: ALL,
  permissions: [
    "prevention:change:manage",
    "prevention:emergency:manage",
    "prevention:emergency:view",
  ],
}

/** Congela `Date` en un instante UTC dado, dejando vivos los temporizadores. */
function fijarReloj(instanteUtc: string) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(instanteUtc))
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionEmergencyResources)
  await inMemoryDb.delete(schema.preventionEmergencyHistory)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.preventionChangeAssessments)
  await inMemoryDb.delete(schema.preventionChangeRequests)
  await inMemoryDb.delete(schema.preventionCommitteeMeetings)
  await inMemoryDb.delete(schema.preventionCommittees)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "u-tz", name: "Prevencionista", email: "tz@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-tz", name: "Faena Cholguán", code: "CHOLTZ", isActive: true,
  })
})

/* ── Los dos helpers compartidos ──────────────────────────────────────────── */

describe("codeYear() y todayInChile() a las 23:00 de Chile", () => {
  it("dan el año y el día chilenos, no los de UTC", () => {
    fijarReloj(NOCHEVIEJA)

    // Control: esto es exactamente lo que devolvía el código corregido.
    expect(new Date().getUTCFullYear()).toBe(2027)
    expect(new Date().toISOString().slice(0, 10)).toBe("2027-01-01")

    expect(codeYear()).toBe(2026)
    expect(todayInChile()).toBe("2026-12-31")
  })

  it("acierta también en invierno austral, con el otro desplazamiento", () => {
    fijarReloj(AGOSTO)

    expect(new Date().toISOString().slice(0, 10)).toBe("2026-08-16")
    expect(todayInChile()).toBe("2026-08-15")
    expect(codeYear()).toBe(2026)
  })
})

/* ── MOC-09 y EMERGENCIAS-12: el año del correlativo ──────────────────────── */

describe("códigos generados la noche del 31 de diciembre", () => {
  it("MOC-09: el cambio nace con el año chileno en el código", async () => {
    fijarReloj(NOCHEVIEJA)

    const cambio = await createChangeRequest({
      worksiteId: "ws-tz",
      title: "Cambio de proveedor de andamios",
      changeType: "proveedor",
      description: "Se reemplaza al proveedor de andamios certificados.",
      reason: "Término de contrato del proveedor anterior.",
    }, ACCESS)

    expect(cambio.code).toMatch(/^GC-2026-/)
    expect(cambio.code).not.toMatch(/^GC-2027-/)
  })

  it("EMERGENCIAS-12: el plan de emergencia también", async () => {
    fijarReloj(NOCHEVIEJA)

    const plan = await createEmergencyPlan({
      worksiteId: "ws-tz",
      title: "Plan de emergencia de la faena",
    }, ACCESS)

    expect(plan.code).toMatch(/^PE-2026-/)
    expect(plan.code).not.toMatch(/^PE-2027-/)
  })
})

/* ── EMERGENCIAS-07: "vencido" contra el calendario chileno ───────────────── */

describe("EMERGENCIAS-07 · vencimiento de equipos de emergencia", () => {
  it("un extintor que vence hoy en Chile aún no está vencido a las 23:00", async () => {
    fijarReloj(AGOSTO)
    const hoy = todayInChile() // 2026-08-15

    const plan = await createEmergencyPlan({
      worksiteId: "ws-tz",
      title: "Plan de emergencia de la faena",
    }, ACCESS)
    await addEmergencyResource({
      planId: plan.id,
      name: "Extintor PQS 10 kg",
      kind: "Extintor",
      location: "Portería",
      expiresAt: hoy,
    }, ACCESS)

    const avisos = await getPreventionAttention({
      worksiteIds: "all",
      includeActions: false,
      includeEvaluations: false,
      includePpa: false,
      includeEmergencyResources: true,
    })

    const extintor = avisos.find((item) => item.kind === "emergency_resource")
    expect(extintor).toBeDefined()
    expect(extintor!.dueDate).toBe(hoy)
    // Con la fecha UTC ("2026-08-16") el equipo se comparaba contra un "hoy"
    // que ya era mañana, así que aparecía vencido —y en rojo— un día antes.
    expect(extintor!.title).toBe("Equipo de emergencia por vencer")
    expect(extintor!.tone).toBe("warning")
  })

  it("uno que venció ayer sí sale vencido", async () => {
    fijarReloj(AGOSTO)

    const plan = await createEmergencyPlan({
      worksiteId: "ws-tz",
      title: "Plan de emergencia de la faena",
    }, ACCESS)
    await addEmergencyResource({
      planId: plan.id,
      name: "Botiquín de faena",
      kind: "Botiquín",
      location: "Oficina técnica",
      expiresAt: "2026-08-14",
    }, ACCESS)

    const avisos = await getPreventionAttention({
      worksiteIds: "all",
      includeActions: false,
      includeEvaluations: false,
      includePpa: false,
      includeEmergencyResources: true,
    })

    const botiquin = avisos.find((item) => item.kind === "emergency_resource")
    expect(botiquin?.title).toBe("Equipo de emergencia vencido")
    expect(botiquin?.tone).toBe("danger")
  })
})

/* ── CPHS-03: el mes de la sesión es el del hecho ─────────────────────────── */

describe("CPHS-03 · meses con acta cerrada", () => {
  beforeEach(async () => {
    await inMemoryDb.insert(schema.preventionCommittees).values({
      id: "cm-tz",
      worksiteId: "ws-tz",
      name: "CPHS Cholguán",
      constitutedOn: "2025-12-01",
      mandateEndsOn: "2027-12-01",
      status: "active",
      createdByUserId: "u-tz",
    })
  })

  async function evidencia() {
    return gatherCertificationEvidence({
      committeeId: "cm-tz",
      worksiteId: "ws-tz",
      periodYear: 2026,
    })
  }

  it("cuenta el mes en que se SESIONÓ, no aquel en que se firmó el acta", async () => {
    fijarReloj(AGOSTO)
    // Sesión de enero, acta cerrada el 3 de febrero: el caso del informe.
    await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
      id: "mt-ene", code: "CPHS-2026-ENE", committeeId: "cm-tz",
      scheduledFor: "2026-01-15T14:00:00.000Z",
      heldAt: "2026-01-15T14:00:00.000Z",
      closedAt: "2026-02-03T10:00:00.000Z",
      agenda: "Sesión ordinaria de enero",
      minutes: "Acta de la sesión ordinaria de enero del comité.",
      status: "closed", quorumReached: true, createdByUserId: "u-tz",
    })
    // Sesión de febrero, cerrada también en febrero.
    await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
      id: "mt-feb", code: "CPHS-2026-FEB", committeeId: "cm-tz",
      scheduledFor: "2026-02-17T14:00:00.000Z",
      heldAt: "2026-02-17T14:00:00.000Z",
      closedAt: "2026-02-20T10:00:00.000Z",
      agenda: "Sesión ordinaria de febrero",
      minutes: "Acta de la sesión ordinaria de febrero del comité.",
      status: "closed", quorumReached: true, createdByUserId: "u-tz",
    })

    // Por `closedAt` ambas caían en febrero y el resultado era 1 mes: el comité
    // sesionó dos meses seguidos y sólo se le acreditaba uno.
    expect((await evidencia()).monthsWithClosedMeeting).toBe(2)
  })

  it("una sesión del 31 a las 23:00 de Chile cuenta en su mes, no en el siguiente", async () => {
    fijarReloj(AGOSTO)
    await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
      id: "mt-31", code: "CPHS-2026-ENE31", committeeId: "cm-tz",
      scheduledFor: FIN_DE_ENERO,
      heldAt: FIN_DE_ENERO, // 2026-01-31 23:00 en Chile, 2026-02-01 en UTC
      closedAt: FIN_DE_ENERO,
      agenda: "Sesión ordinaria de cierre de enero",
      minutes: "Acta de la sesión ordinaria de cierre de enero del comité.",
      status: "closed", quorumReached: true, createdByUserId: "u-tz",
    })
    await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
      id: "mt-feb2", code: "CPHS-2026-FEB2", committeeId: "cm-tz",
      scheduledFor: "2026-02-17T14:00:00.000Z",
      heldAt: "2026-02-17T14:00:00.000Z",
      closedAt: "2026-02-20T10:00:00.000Z",
      agenda: "Sesión ordinaria de febrero",
      minutes: "Acta de la sesión ordinaria de febrero del comité.",
      status: "closed", quorumReached: true, createdByUserId: "u-tz",
    })

    // Cortando el timestamp en UTC ambas quedaban en "2026-02" y contaban 1.
    expect((await evidencia()).monthsWithClosedMeeting).toBe(2)
  })

  it("no descuenta una sesión antigua sin heldAt: cae de vuelta en closedAt", async () => {
    fijarReloj(AGOSTO)
    await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
      id: "mt-legacy", code: "CPHS-2026-LEG", committeeId: "cm-tz",
      scheduledFor: "2026-03-10T14:00:00.000Z",
      heldAt: null,
      closedAt: "2026-03-12T10:00:00.000Z",
      agenda: "Sesión ordinaria de marzo",
      minutes: "Acta de la sesión ordinaria de marzo del comité.",
      status: "closed", quorumReached: true, createdByUserId: "u-tz",
    })

    expect((await evidencia()).monthsWithClosedMeeting).toBe(1)
  })
})

/* ── MIPER-09 y LEGAL-08: la fecha "hoy" de las dos pantallas ─────────────── */

describe("MIPER-09 y LEGAL-08 · fecha por defecto de las pantallas", () => {
  it("MIPER-09: la vigencia se resuelve en el servidor y con calendario chileno", async () => {
    const { readFileSync } = await import("node:fs")
    const page = readFileSync("app/(app)/prevencion/miper/page.tsx", "utf8")

    // Sigue calculándose una sola vez en el componente de servidor y bajando
    // como prop — es lo que evita el desajuste de hidratación.
    expect(page).toContain("const today = todayInChile()")
    expect(page).toContain("today={today}")
    expect(page).not.toContain("new Date().toISOString().slice(0, 10)")
  })

  it("LEGAL-08: 'Vigente desde' nace con el día chileno", async () => {
    const { readFileSync } = await import("node:fs")
    const workbench = readFileSync(
      "app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx", "utf8")

    expect(workbench).toContain('<DatePicker name="validFrom" defaultValue={todayInChile()} />')
    expect(workbench).not.toContain("new Date().toISOString().slice(0, 10)")
  })
})

/* ── Barrido: que no vuelva a entrar por la puerta de al lado ─────────────── */

describe("barrido de regresión", () => {
  it("ningún servicio de Prevención genera códigos con getUTCFullYear()", async () => {
    const { readFileSync, readdirSync } = await import("node:fs")
    const dir = "lib/services"
    const sospechosos = readdirSync(dir)
      .filter((name) => name.startsWith("prevention-") && name.endsWith(".ts"))
      .filter((name) => readFileSync(path.join(dir, name), "utf8").includes("getUTCFullYear()"))

    expect(sospechosos).toEqual([])
  })
})
