import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { resolvePdtpEvidenceDir } from "@/lib/storage/config"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

/**
 * Hermeticidad (esta suite borra archivos reales si se la deja suelta).
 *
 * El recolector deriva su directorio de `STORAGE_PATH` en cada llamada
 * (`lib/storage/config.ts`: `resolveStorageDir()` → `resolvePdtpEvidenceDir()`).
 * Si la variable queda vacía o vuelve al valor original, el barrido cae sobre
 * `storage/` del repo y, como `dryRun` es `false` por defecto, lo BORRA.
 *
 * Por eso el archivo entero queda anclado a un sandbox propio desde el momento
 * de importarse: se captura el valor original una sola vez —antes de que
 * cualquier hook lo pise— y no se restaura hasta `afterAll`.
 */
const originalStoragePath = process.env.STORAGE_PATH
const storageSandbox = mkdtempSync(join(tmpdir(), "pdtp-evidence-gc-sandbox-"))

function restoreStoragePathEnv(): void {
  // `process.env.X = undefined` guarda la cadena "undefined" en Node: si la
  // variable no existía hay que borrarla, no asignarle `undefined`.
  if (originalStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = originalStoragePath
}

process.env.STORAGE_PATH = storageSandbox

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  rmSync(storageSandbox, { recursive: true, force: true })
  restoreStoragePathEnv()
})

let tempDir: string

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  tempDir = mkdtempSync(join(tmpdir(), "pdtp-evidence-gc-"))
  process.env.STORAGE_PATH = tempDir
  // Crear la estructura pdtp-evidence
  const { promises: fs } = await import("node:fs")
  await fs.mkdir(join(tempDir, "pdtp-evidence"), { recursive: true })
  // Guardrail: el recolector tiene que apuntar al temp de la prueba. Si dejara
  // de hacerlo, el barrido de más abajo borraría archivos reales de `storage/`.
  expect(resolvePdtpEvidenceDir()).toBe(join(tempDir, "pdtp-evidence"))
})

afterEach(() => {
  // Vuelve al sandbox del archivo, nunca al valor del entorno: entre tests el
  // colector jamás debe poder resolver el `storage/` del repo.
  process.env.STORAGE_PATH = storageSandbox
  rmSync(tempDir, { recursive: true, force: true })
})

describe("cleanupPdtpEvidenceOrphans", () => {
  it("elimina archivos no referenciados en la DB y mayores al umbral", async () => {
    // Crear 3 archivos: uno referenciado, dos huérfanos
    const referencedName = "abc-referenced.pdf"
    const orphanOldName = "abc-orphan-old.pdf"
    const orphanRecentName = "abc-orphan-recent.pdf"

    writeFileSync(join(tempDir, "pdtp-evidence", referencedName), "PDF_DATA")
    writeFileSync(join(tempDir, "pdtp-evidence", orphanOldName), "PDF_OLD")

    // Mtime antiguo para orphan-old
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000) // 2h
    const { utimesSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanOldName), oldTime, oldTime)

    writeFileSync(join(tempDir, "pdtp-evidence", orphanRecentName), "PDF_NEW")

    // Insertar programa + actividad + ejecución que referencia solo a referencedName
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "prog-1", year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "T",
      elaboratedByName: "X", elaboratedByTitle: "Y",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-1", programId: "prog-1", n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
      sourceSheetRow: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-1",
      activityId: "act-1",
      worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      executedQuantity: 1,
      status: "approved",
      evidenceUrl: `storage/pdtp-evidence/${referencedName}`,
      evidencePhotos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.scanned).toBe(3)
    expect(result.deleted).toBe(1)
    expect(result.deletedNames).toEqual([orphanOldName])
    expect(result.kept).toBe(2) // referenced + orphanRecent (reciente)

    // El archivo old no debe existir
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanOldName))).toBe(false)
    expect(existsSync(join(tempDir, "pdtp-evidence", referencedName))).toBe(true)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanRecentName))).toBe(true)
  })

  it("conserva la evidencia referenciada SÓLO desde prevention_capa_evidence", async () => {
    // Regresión GC-01: el directorio tiene dos productores. La evidencia de
    // cierre de una acción correctiva se sube por el mismo endpoint pero se
    // vincula a `prevention_capa_evidence`, no a `pdtp_executions`. Antes se
    // borraba una hora después de subirla.
    const capaPhotoName = "abc-capa-evidence.jpg"
    const orphanName = "abc-orphan.pdf"
    for (const name of [capaPhotoName, orphanName]) {
      writeFileSync(join(tempDir, "pdtp-evidence", name), "DATA")
    }
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { utimesSync } = await import("node:fs")
    for (const name of [capaPhotoName, orphanName]) {
      utimesSync(join(tempDir, "pdtp-evidence", name), oldTime, oldTime)
    }

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    })
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-1", code: "CAPA-2026-0001", sourceType: "pdtp", sourceId: "exec-1",
      worksiteId: "w1", finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-09-01", createdByUserId: "u1", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaEvidence).values({
      id: "capaev-1", actionId: "capa-1", kind: "photo",
      reference: `storage/pdtp-evidence/${capaPhotoName}`,
      uploadedByUserId: "u1", createdAt: now,
    })

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.deletedNames).toEqual([orphanName])
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", capaPhotoName))).toBe(true)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(false)
  })

  it("dryRun=true no elimina archivos", async () => {
    const orphanName = "abc-orphan.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF_OLD")
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { utimesSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), oldTime, oldTime)

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ dryRun: true, olderThanMs: 60 * 60 * 1000 })

    expect(result.deleted).toBe(1)
    expect(result.deletedNames).toEqual([orphanName])

    // En dryRun el archivo sigue existiendo
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(true)
  })

  it("devuelve resultado vacío si no hay directorio de storage", async () => {
    // PROBLEMA QUE ESTO EVITA (nuevo, 2026-09-30): esta prueba restauraba el
    // valor original de `STORAGE_PATH` —vacío en esta máquina— para simular un
    // storage inexistente. Con la variable vacía, `resolveStorageDir()` cae al
    // default `process.cwd()/storage`: el recolector barría el `storage/` real
    // del repo y, en modo real (`dryRun` por defecto), borraba sus archivos.
    // El directorio tiene que desaparecer, pero CUÁL desaparece lo decide la
    // prueba: un temp propio, creado y borrado acá.
    const missingDir = mkdtempSync(join(tmpdir(), "pdtp-evidence-gc-missing-"))
    rmSync(missingDir, { recursive: true, force: true })
    process.env.STORAGE_PATH = missingDir

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans()

    expect(result.scanned).toBe(0)
    expect(result.deleted).toBe(0)
  })

  /* W5-GC (T7a, D13): el barrido se agenda en modo de prueba. Para que las
   * semanas de revisión sirvan de algo, cada corrida que encuentra huérfanos
   * deja constancia en `audit_log` —qué habría borrado o qué borró— y la
   * ventana de gracia no puede bajar de una hora aunque alguien lo pida. */
  it("deja en audit_log lo que borró, con el directorio y el modo", async () => {
    const orphanName = "abc-orphan-audit.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF_OLD")
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { utimesSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), oldTime, oldTime)

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    const rows = await inMemoryDb.select().from(schema.auditLog)
    expect(rows).toHaveLength(1)
    expect(rows[0]!).toMatchObject({ action: "delete", entityType: "storage_orphan_sweep", userId: null })
    expect(JSON.parse(rows[0]!.newState!)).toMatchObject({
      label: "pdtp/evidence-gc", dryRun: false, deleted: 1, names: [orphanName], truncated: false,
    })
  })

  it("en modo de prueba audita los candidatos sin borrarlos", async () => {
    const orphanName = "abc-orphan-dry.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF_OLD")
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { utimesSync, existsSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), oldTime, oldTime)

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    await cleanupPdtpEvidenceOrphans({ dryRun: true, olderThanMs: 60 * 60 * 1000 })

    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(true)
    const [row] = await inMemoryDb.select().from(schema.auditLog)
    expect(JSON.parse(row!.newState!)).toMatchObject({ dryRun: true, deleted: 1, names: [orphanName] })
    expect(row!.reason).toMatch(/prueba/i)
  })

  it("una corrida sin huérfanos no escribe en audit_log", async () => {
    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })

  /* Revisión final 2026-09-27 (hallazgo 2): quien sube en terreno puede
   * enviar el formulario horas después. Una hora de gracia borraba ese upload
   * antes del envío; el mínimo es ahora de 24 horas. */
  it("un upload de hace 2 horas todavía sin vincular no se toca, aunque se pida una hora", async () => {
    const orphanName = "abc-upload-2h.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF")
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const { utimesSync, existsSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), twoHoursAgo, twoHoursAgo)

    const { cleanupPdtpEvidenceOrphans, MIN_ORPHAN_AGE_MS } = await import("@/lib/services/pdtp/evidence-gc")
    expect(MIN_ORPHAN_AGE_MS).toBe(24 * 60 * 60 * 1000)
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.deleted).toBe(0)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(true)
  })

  it("la ventana de gracia no baja de una hora aunque se pida menos", async () => {
    const orphanName = "abc-orphan-30min.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF")
    const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000)
    const { utimesSync, existsSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), halfHourAgo, halfHourAgo)

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 0 })

    expect(result.deleted).toBe(0)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(true)
  })

  it("el barrido de planos de riesgo también audita", async () => {
    const { promises: fs, utimesSync } = await import("node:fs")
    await fs.mkdir(join(tempDir, "risk-map"), { recursive: true })
    const orphanName = "plano-huerfano.png"
    writeFileSync(join(tempDir, "risk-map", orphanName), "PNG")
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    utimesSync(join(tempDir, "risk-map", orphanName), oldTime, oldTime)

    const { cleanupRiskMapOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    await cleanupRiskMapOrphans({ dryRun: true })

    const [row] = await inMemoryDb.select().from(schema.auditLog)
    expect(JSON.parse(row!.newState!)).toMatchObject({ label: "risk-map/evidence-gc", dryRun: true, names: [orphanName] })
  })
})
