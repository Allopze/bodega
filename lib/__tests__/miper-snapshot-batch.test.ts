/**
 * Fase B: `buildMiperSnapshots` (lote) y `buildMiperSnapshot` como su caso de
 * una. PRUEBA DORADA: `snapshotSha` hashea `JSON.stringify(foto)` y ese hash
 * queda sellado en cada ronda y cada versión, así que la foto de antes y la de
 * ahora tienen que ser idénticas byte a byte: mismas filas, mismo orden de filas
 * y de medidas, mismo orden de CLAVES (`toEqual` no lo mira; por eso se compara
 * el JSON).
 *
 * Fase C (D5): la foto suma `isExisting` y `verificationFrequency` AL FINAL de
 * cada medida. La prueba dorada sigue comparando byte a byte con la copia
 * literal de antes, quitando sólo esas dos claves (`sinClavesFaseC`), y afirma
 * aparte que son las dos últimas: así se sabe que nada más cambió de lugar.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq, inArray } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskTasks,
} from "@/db/schema"
import type { DB } from "@/db"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ControlHierarchy, ControlledStatus, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { buildMiperSnapshot, buildMiperSnapshots, snapshotSha } = await import("@/lib/services/miper/snapshots")

type Client = DB

/**
 * COPIA LITERAL de `buildMiperSnapshot` en `lib/services/miper/snapshots.ts:15-64`
 * (commit 4f980172), antes del lote. Es la referencia dorada: NO EDITAR.
 */
async function legacyBuildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await client.select({
    entry: preventionRiskEntries,
    activity: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
    location: preventionRiskLocations.name,
    riskFactor: preventionRiskFactors.name,
  }).from(preventionRiskEntries)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .leftJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .leftJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .leftJoin(preventionRiskLocations, eq(preventionRiskLocations.id, preventionRiskEntries.locationId))
    .leftJoin(preventionRiskFactors, eq(preventionRiskFactors.id, preventionRiskEntries.riskFactorId))
    .where(eq(preventionRiskEntries.matrixId, matrixId))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  const controls = rows.length === 0 ? [] : await client.select().from(preventionRiskControls)
    .where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id)))
    .orderBy(asc(preventionRiskControls.createdAt))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])
  return {
    header: {
      period: matrix.period, iperCode: matrix.iperCode, elaboratedOn: matrix.elaboratedOn, updatedOn: matrix.updatedOn,
      companyName: matrix.companyName, companyRut: matrix.companyRut, companyAddress: matrix.companyAddress, companyCommune: matrix.companyCommune,
      economicActivity: matrix.economicActivity, adherentNumber: matrix.adherentNumber, worksiteName: matrix.worksiteName,
      siteRepresentativeUserId: matrix.siteRepresentativeUserId, siteRepresentativeName: matrix.siteRepresentativeName,
      headcountTotal: matrix.headcountTotal, headcountMale: matrix.headcountMale, headcountFemale: matrix.headcountFemale, headcountOther: matrix.headcountOther,
      participationSummary: matrix.participationSummary, consultationEvidenceReference: matrix.consultationEvidenceReference,
    },
    entries: rows.map(({ entry, activity, task, position, location, riskFactor }, index) => ({
      id: entry.id,
      rowNumber: entry.rowNumber ?? index + 1,
      activity, task, position, location,
      exposedFemale: entry.exposedFemale, exposedMale: entry.exposedMale, exposedOther: entry.exposedOther,
      riskFactorId: entry.riskFactorId, riskFactor,
      isRoutine: entry.isRoutine,
      hazard: entry.hazard, risk: entry.risk, probableDamage: entry.probableDamage,
      probability: entry.probability, consequence: entry.consequence, magnitude: entry.magnitude,
      classification: entry.classification as RiskClassification | null,
      controlledStatus: entry.controlledStatus as ControlledStatus | null,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
    })),
  }
}

/** La foto sin las dos claves que la Fase C agrega al final de cada medida. Quitar claves no mueve las demás. */
function sinClavesFaseC(snapshot: MiperSnapshot): MiperSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      controls: entry.controls.map(({ isExisting: _existing, verificationFrequency: _frequency, ...control }) => control),
    })),
  }
}

const author = { userId: "u-g", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:edit"] }
let a = ""
let b = ""
let empty = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-g1", name: "Faena G1", code: "G1" }, { id: "ws-g2", name: "Faena G2", code: "G2" }])
  await testDb.insert(schema.users).values({ id: "u-g", name: "Autora G", email: "g@g.cl", hashedPassword: "x", isActive: true })
  a = (await createMiper({ worksiteId: "ws-g1", period: 2026, revisionReason: "Período para la prueba dorada." }, author)).id
  b = (await createMiper({ worksiteId: "ws-g1", period: 2027, revisionReason: "Segundo período de la prueba dorada." }, author)).id
  empty = (await createMiper({ worksiteId: "ws-g2", period: 2026, revisionReason: "MIPER sin riesgos de la prueba dorada." }, author)).id

  // Filas de A y B intercaladas en el tiempo: el lote las separa por MIPER sin mezclar su orden.
  const a1 = await saveMiperEntry({ matrixId: a, values: { activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactorId: "riskfactor-mecanico", hazard: "Carga suspendida", risk: "Golpe", probableDamage: "Fractura", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
  await saveMiperEntry({ matrixId: b, values: { activity: "Bodega", task: "Orden", hazard: "Estanterías", probability: 1, consequence: 2 } }, author)
  const a2 = await saveMiperEntry({ matrixId: a, values: { hazard: "Ruido", probability: 2, consequence: 2, controlledStatus: "no" } }, author)
  const c1 = await saveMiperControl({ matrixId: a, entryId: a1.id, values: { hierarchy: "engineering", description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" } }, author)
  const c2 = await saveMiperControl({ matrixId: a, entryId: a2.id, values: { hierarchy: "ppe", description: "Protectores auditivos", responsibleUserId: "u-g", dueDate: "2026-11-30" } }, author)
  const c3 = await saveMiperControl({ matrixId: a, entryId: a1.id, values: { hierarchy: "administrative", description: "Señalero en el izaje", responsibleName: "Supervisión", dueDate: "2026-12-31" } }, author)
  // `created_at` distintos y explícitos: con empate, el orden de Postgres no está definido (ni antes ni ahora).
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
  for (const [id, seconds] of [[c1.id, 1], [c2.id, 2], [c3.id, 3]] as const) {
    await testDb.update(schema.preventionRiskControls).set({ createdAt: later(seconds) }).where(eq(schema.preventionRiskControls.id, id))
  }
  // Dos filas de B sin N° (cargas antiguas): el respaldo `index + 1` es la posición DENTRO de B.
  await testDb.insert(schema.preventionRiskEntries).values([
    { id: "riskentry-g-b2", matrixId: b, hazardCode: "HAZ-G-B2", hazard: "Sin número uno", createdAt: later(5), updatedAt: later(5) },
    { id: "riskentry-g-b3", matrixId: b, hazardCode: "HAZ-G-B3", hazard: "Sin número dos", createdAt: later(10), updatedAt: later(10) },
  ])
}, 60_000)

describe("fotos del MIPER en lote (Fase B)", () => {
  it("PRUEBA DORADA: buildMiperSnapshot da la misma foto que antes, byte a byte (JSON y SHA), salvo las dos claves de la Fase C al final de cada medida", async () => {
    for (const id of [a, b, empty]) {
      const before = await legacyBuildMiperSnapshot(testDb, id)
      const after = await buildMiperSnapshot(testDb, id)
      expect(JSON.stringify(sinClavesFaseC(after))).toBe(JSON.stringify(before))
      expect(snapshotSha(sinClavesFaseC(after))).toBe(snapshotSha(before))
      for (const control of after.entries.flatMap((entry) => entry.controls)) {
        expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
      }
    }
  })

  it("el lote arma cada foto igual que una por una, aunque los ids vengan repetidos o en otro orden", async () => {
    const batch = await buildMiperSnapshots(testDb, [empty, b, a, b])
    expect([...batch.keys()].sort()).toEqual([a, b, empty].sort())
    for (const id of [a, b, empty]) {
      expect(JSON.stringify(sinClavesFaseC(batch.get(id)!))).toBe(JSON.stringify(await legacyBuildMiperSnapshot(testDb, id)))
    }
  })

  it("el N° de respaldo de una fila sin número cuenta dentro de su MIPER, no en el lote", async () => {
    const batch = await buildMiperSnapshots(testDb, [a, b])
    expect(batch.get(b)!.entries.map((entry) => [entry.hazard, entry.rowNumber])).toEqual([["Estanterías", 1], ["Sin número uno", 2], ["Sin número dos", 3]])
    expect(batch.get(a)!.entries.map((entry) => entry.controls.map((control) => control.description)))
      .toEqual([["Limitador de carga", "Señalero en el izaje"], ["Protectores auditivos"]])
  })

  it("sin ids devuelve un mapa vacío; un id inexistente no viene en el lote y la foto suelta lo rechaza", async () => {
    expect((await buildMiperSnapshots(testDb, [])).size).toBe(0)
    expect((await buildMiperSnapshots(testDb, ["riskmatrix-no-existe"])).size).toBe(0)
    await expect(buildMiperSnapshot(testDb, "riskmatrix-no-existe")).rejects.toThrow("MIPER no encontrada o fuera de alcance.")
  })

  it("medidas con el mismo created_at salen por id: el orden no queda al azar (arrastre de la Fase B)", async () => {
    const tie = (await createMiper({ worksiteId: "ws-g2", period: 2027, revisionReason: "MIPER para el desempate de medidas." }, author)).id
    const entry = await saveMiperEntry({ matrixId: tie, values: { hazard: "Empate de medidas", probability: 1, consequence: 2 } }, author)
    const same = new Date(Date.now() + 60_000).toISOString()
    // Al revés del orden por id: sin desempate, Postgres las devuelve en el orden que le acomode.
    await testDb.insert(schema.preventionRiskControls).values(["riskcontrol-tie-c", "riskcontrol-tie-b", "riskcontrol-tie-a"].map((id) => ({
      id, riskEntryId: entry.id, hierarchy: "administrative", description: `Medida ${id.slice(-1)}`, createdAt: same, updatedAt: same,
    })))
    const ids = (await buildMiperSnapshot(testDb, tie)).entries[0]!.controls.map((control) => control.id)
    expect(ids).toEqual(["riskcontrol-tie-a", "riskcontrol-tie-b", "riskcontrol-tie-c"])
    // El lote dice lo mismo que la foto suelta.
    expect((await buildMiperSnapshots(testDb, [tie])).get(tie)!.entries[0]!.controls.map((control) => control.id)).toEqual(ids)
  })
})
