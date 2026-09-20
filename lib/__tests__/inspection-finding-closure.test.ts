/**
 * El estado de un hallazgo de inspección **sí** llega a `closed`.
 *
 * `INS-001` de la auditoría 2026-09-14 afirmaba lo contrario: que sólo existía
 * escritor para `capa_linked` y que por eso la ficha mostraba «vinculado a
 * CAPA» para siempre. La Fase 7 lo refutó —hay tres escritores desde el arreglo
 * B-06 del 2026-08-18— y encontró de dónde salía el error: un comentario
 * obsoleto en `lib/services/pdtp/compliance.ts` que se citó como si fuera una
 * comprobación del código.
 *
 * La vía de mantención ya estaba cubierta en
 * `prevention-inspections-postgres.test.ts`, pero esa suite exige un PostgreSQL
 * desechable con gate destructivo y hoy se salta. Ésta corre siempre.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { transitionCapaAction, addCapaEvidence } = await import("@/lib/services/prevention-capa")
const { completeInspectionRun } = await import("@/lib/services/prevention-inspections")

const AUTOR = "user-insc-autor"
const VERIFICADOR = "user-insc-verificador"
const WS = "ws-insc-1"
const NOW = "2026-09-14T12:00:00.000Z"

const PERMISOS = [
  "prevention:capa:view", "prevention:capa:manage",
  "prevention:capa:verify", "prevention:capa:close",
]

/** Una inspección con un hallazgo ya derivado a CAPA, que es el punto de partida. */
async function seedFindingWithCapa() {
  const templateId = nanoid()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: templateId, code: `PLT-${nanoid(5)}`, versionLabel: "v1", name: "Extintores",
    kind: "inspection", definitionSnapshot: {}, contentHash: "a".repeat(64),
    status: "draft", authorUserId: AUTOR,
  })
  const runId = nanoid()
  await testDb.insert(schema.preventionInspectionRuns).values({
    id: runId, code: `INS-${nanoid(5)}`, templateId, worksiteId: WS,
    status: "completed", createdByUserId: AUTOR,
  })
  const capaId = nanoid()
  await testDb.insert(schema.preventionCapaActions).values({
    id: capaId, code: `CAPA-${nanoid(5)}`, sourceType: "inspection", sourceId: runId,
    worksiteId: WS, finding: "Extintor con manómetro en zona roja",
    actionDescription: "Recargar y certificar el extintor", targetDate: "2026-10-01",
    status: "pending_verification", createdByUserId: AUTOR,
    createdAt: NOW, updatedAt: NOW,
  })
  // Verificar una CAPA exige la evidencia comprometida: es otro control del
  // módulo y aquí se cumple en vez de esquivarlo.
  await testDb.insert(schema.preventionCapaEvidence).values({
    id: nanoid(), actionId: capaId, kind: "photo",
    reference: "storage/prevencion/capa/extintor-recargado.jpg",
    uploadedByUserId: AUTOR, createdAt: NOW,
  })

  const findingId = nanoid()
  await testDb.insert(schema.preventionInspectionFindings).values({
    id: findingId, runId, description: "Extintor con manómetro en zona roja",
    criticality: "high", status: "capa_linked", capaActionId: capaId,
  })
  return { findingId, capaId }
}

const findingStatus = async (id: string) =>
  (await testDb.select().from(schema.preventionInspectionFindings)
    .where(eq(schema.preventionInspectionFindings.id, id)))[0]

async function transition(capaId: string, toStatus: string, reason: string) {
  const [capa] = await testDb.select({ version: schema.preventionCapaActions.version })
    .from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
  // Verificar exige además declarar la eficacia: otro control del módulo que se
  // cumple en vez de esquivarse, para que el camino probado sea el real.
  const eficacia = toStatus === "verified"
    ? {
        effectivenessStatus: "effective" as const,
        effectivenessAssessment: "Se comprobó en terreno la presión correcta del manómetro",
      }
    : {}
  return transitionCapaAction({
    input: { actionId: capaId, expectedVersion: capa!.version, toStatus, reason, ...eficacia },
    ctx: { userId: VERIFICADOR },
    scope: { mode: "all", ids: [] },
    permissions: PERMISOS,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: AUTOR, name: "Autor", email: "autor@insc.cl", hashedPassword: "x", isActive: true },
    { id: VERIFICADOR, name: "Verificador", email: "verif@insc.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Inspección", code: "INSC", isActive: true })
})

beforeEach(async () => {
  await testDb.delete(schema.preventionInspectionFindings)
  await testDb.delete(schema.preventionCapaActions)
  await testDb.delete(schema.preventionInspectionRuns)
  await testDb.delete(schema.preventionInspectionTemplates)
})

describe("INS-001 (refutado) — el hallazgo sigue la suerte de su CAPA", () => {
  it("verificar la CAPA cierra el hallazgo, con fecha y responsable", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    await transition(capaId, "verified", "Extintor recargado y certificado en terreno")

    const finding = await findingStatus(findingId)
    expect(finding?.status).toBe("closed")
    expect(finding?.closedAt).toBeTruthy()
    expect(finding?.closedByUserId).toBe(VERIFICADOR)
  })

  it("cerrar la CAPA también lo cierra", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    await transition(capaId, "verified", "Extintor recargado y certificado en terreno")
    await transition(capaId, "closed", "Acción cerrada tras verificación en terreno")
    expect((await findingStatus(findingId))?.status).toBe("closed")
  })

  /* La cuarta transición, la que faltaba. Cancelar la acción no resuelve la
   * desviación: lo que se canceló es el intento de corregirla.
   *
   * Sin propagarla, el hallazgo quedaba `capa_linked` para siempre —contando
   * como crítico abierto en el dashboard, invisible para el programador y
   * rechazado por `closeInspectionFinding` porque conservaba el vínculo—. Un
   * callejón sin salida por la interfaz. */
  it("cancelar la CAPA devuelve el hallazgo a abierto y suelta el vínculo", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    expect((await findingStatus(findingId))?.status).toBe("capa_linked")

    await transition(capaId, "cancelled", "La acción se cargó en la faena equivocada")

    const liberado = await findingStatus(findingId)
    expect(liberado?.status).toBe("open")
    expect(liberado?.capaActionId).toBeNull()
    expect(liberado?.closedAt).toBeNull()
  })

  /* El vínculo se suelta además del estado porque el guard de cierre mira
   * `capa_action_id`, no el estado: dejarlo puesto mantendría el callejón. */
  it("y entonces sí se puede cerrar a mano, que antes era imposible", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    await transition(capaId, "cancelled", "La acción se cargó en la faena equivocada")

    const service = await import("@/lib/services/prevention-inspections")
    await service.closeInspectionFinding({
      findingId,
      reason: "La condición se corrigió en terreno y se verificó en la ronda siguiente.",
    }, {
      userId: VERIFICADOR,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:inspections:review"],
    })

    expect((await findingStatus(findingId))?.status).toBe("closed")
  })

  it("y reabrirla lo devuelve a vinculado: la simetría también existe", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    await transition(capaId, "verified", "Extintor recargado y certificado en terreno")
    expect((await findingStatus(findingId))?.status).toBe("closed")

    await transition(capaId, "reopened", "El manómetro volvió a caer a zona roja")
    const reabierto = await findingStatus(findingId)
    expect(reabierto?.status).toBe("capa_linked")
    expect(reabierto?.closedAt).toBeNull()
    expect(reabierto?.closedByUserId).toBeNull()
  })
})

/**
 * CAPA-001 (auditoría 2026-09-14), patrón P4: una evidencia era una cadena de 3
 * a 4000 caracteres con el tipo declarado por el cliente y el checksum
 * opcional. Escribir `kind: "photo"`, `reference: "foto tomada en terreno"`
 * satisfacía el gate de verificación y habilitaba cerrar la acción — y esta
 * acción es lo que otros módulos usan como prueba.
 *
 * El estándar riguroso ya existía en la evidencia de un hallazgo de inspección;
 * lo que faltaba era que fuera uno solo (`lib/validation/evidence-contract.ts`).
 */
describe("CAPA-001 — la evidencia que abre la verificación", () => {
  async function capaAbierta() {
    const { capaId } = await seedFindingWithCapa()
    await testDb.update(schema.preventionCapaActions)
      .set({ status: "in_progress" })
      .where(eq(schema.preventionCapaActions.id, capaId))
    const [row] = await testDb.select({ version: schema.preventionCapaActions.version })
      .from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    return { capaId, version: row!.version }
  }

  const add = (capaId: string, version: number, evidence: Record<string, unknown>) =>
    addCapaEvidence({
      input: { actionId: capaId, expectedVersion: version, ...evidence },
      ctx: { userId: AUTOR },
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:capa:view", "prevention:capa:complete"],
    })

  it("una foto que es sólo texto ya no pasa", async () => {
    const { capaId, version } = await capaAbierta()
    await expect(add(capaId, version, {
      kind: "photo", reference: "foto tomada en terreno",
    })).rejects.toThrow(/storage/)
  })

  it("una ruta correcta sin checksum tampoco", async () => {
    const { capaId, version } = await capaAbierta()
    await expect(add(capaId, version, {
      kind: "document", reference: "storage/pdtp-evidence/acta.pdf",
    })).rejects.toThrow(/checksum/i)
  })

  it("un archivo real, con su ruta y su checksum, sí", async () => {
    const { capaId, version } = await capaAbierta()
    await expect(add(capaId, version, {
      kind: "document",
      reference: "storage/pdtp-evidence/acta-2026-09.pdf",
      checksumSha256: "b".repeat(64),
    })).resolves.toBeTruthy()
  })

  it("una nota sigue admitiéndose libre: no sostiene la verificación", async () => {
    // El gate de verificación ya exigía al menos una evidencia que **no** sea
    // nota, así que apretarle el formato no habría ganado control.
    const { capaId, version } = await capaAbierta()
    await expect(add(capaId, version, {
      kind: "note", reference: "Se coordinó la reparación con el supervisor",
    })).resolves.toBeTruthy()
  })
})

/**
 * INS-002 (auditoría 2026-09-14): el acta de cierre declaraba hasta veinte
 * firmas con rol, nombre y un `userId` **opcional**, y nada comprobaba que
 * quien firma exista. Un nombre tecleado bastaba, y el acta es el documento que
 * respalda la inspección ante un tercero — en un módulo que para la evidencia
 * fotográfica sí exige SHA-256.
 *
 * No se exige `userId`: la firma del representante del mandante es legítima y
 * esa persona no es usuario del sistema. Lo que se exige es decir cuál es cuál.
 */
describe("INS-002 — las firmas del acta de cierre", () => {
  async function runEnCurso() {
    const templateId = nanoid()
    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: templateId, code: `PLT-${nanoid(5)}`, versionLabel: "v1", name: "Acta",
      kind: "inspection", definitionSnapshot: {}, contentHash: "a".repeat(64),
      status: "draft", authorUserId: AUTOR,
    })
    const runId = nanoid()
    await testDb.insert(schema.preventionInspectionRuns).values({
      id: runId, code: `INS-${nanoid(5)}`, templateId, worksiteId: WS,
      status: "in_progress", createdByUserId: AUTOR,
    })
    const [row] = await testDb.select({ version: schema.preventionInspectionRuns.version })
      .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, runId))
    return { runId, version: row!.version }
  }

  const cerrar = (runId: string, version: number, signatures: unknown[]) =>
    completeInspectionRun({
      runId, expectedVersion: version,
      closingAct: { result: "conforme", signatures },
    }, {
      userId: VERIFICADOR,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:inspections:execute", "prevention:inspections:view"],
    })

  const firmasDe = async (runId: string) =>
    (await testDb.select({ s: schema.preventionInspectionRuns.closingSignatures })
      .from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, runId)))[0]?.s ?? []

  it("una firma con usuario real queda verificada, y el nombre lo pone la plataforma", async () => {
    const { runId, version } = await runEnCurso()
    await cerrar(runId, version, [
      { role: "prevencionista", name: "Nombre tecleado a mano", userId: AUTOR },
    ])

    const [firma] = await firmasDe(runId)
    expect(firma?.verified).toBe(true)
    expect(firma?.userId).toBe(AUTOR)
    // El nombre sale del registro, no del formulario: era la vía para atribuir
    // una firma a alguien escribiendo otro nombre junto a su id.
    expect(firma?.name).toBe("Autor")
    // Y queda quién la tecleó, que antes sólo constaba para el cierre completo.
    expect(firma?.capturedByUserId).toBe(VERIFICADOR)
  })

  it("una firma sin usuario se admite, pero declarada: no verificada", async () => {
    const { runId, version } = await runEnCurso()
    await cerrar(runId, version, [
      { role: "representante del mandante", name: "Carla Fuentes" },
    ])

    const [firma] = await firmasDe(runId)
    expect(firma?.verified).toBe(false)
    expect(firma?.userId).toBeNull()
    expect(firma?.name).toBe("Carla Fuentes")
  })

  it("un id inventado no verifica ni hace fallar el acta", async () => {
    // Un acta puede llegar de una cola sin conexión con un id rancio; perder el
    // acta entera por eso sería peor que registrar la firma como declarada.
    const { runId, version } = await runEnCurso()
    await cerrar(runId, version, [
      { role: "supervisor", name: "Quien sea", userId: "usuario-que-no-existe" },
    ])

    const [firma] = await firmasDe(runId)
    expect(firma?.verified).toBe(false)
    expect(firma?.userId).toBeNull()
    expect(firma?.name).toBe("Quien sea")
  })

  it("un usuario inactivo tampoco verifica", async () => {
    const inactivo = nanoid()
    await testDb.insert(schema.users).values({
      id: inactivo, name: "Ex trabajador", email: `${inactivo}@insc.cl`,
      hashedPassword: "x", isActive: false,
    })
    const { runId, version } = await runEnCurso()
    await cerrar(runId, version, [{ role: "supervisor", name: "Ex", userId: inactivo }])

    const [firma] = await firmasDe(runId)
    expect(firma?.verified).toBe(false)
  })
})
