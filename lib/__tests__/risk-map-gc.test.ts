/**
 * MIP-002 — Los planos de riesgo archivados siguen sirviéndose y sus archivos
 * nunca se eliminan.
 *
 * Subir un plano nuevo archiva el anterior, pero `storage/risk-map/` no tenía
 * recolección de ninguna clase: un archivo que nunca llegó a registrarse en
 * base —o cuya fila desapareció con su faena por cascada— quedaba en disco
 * para siempre, y nada distinguía "histórico conservado a propósito" de
 * "archivo olvidado".
 *
 * Lo que se prueba acá es exactamente eso y nada más: se borra lo que NINGUNA
 * fila referencia. Un plano archivado y referenciado se conserva, porque la
 * plataforma no declara política de retención para el mapa de riesgos y esa
 * decisión no le corresponde al recolector.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const mockAuthFn = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

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

let tempDir: string
let originalStoragePath: string | undefined

/** Dos horas atrás: fuera de la ventana de gracia del recolector. */
function ageFile(file: string): void {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
  utimesSync(file, old, old)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionRiskMapMarkers)
  await inMemoryDb.delete(schema.preventionRiskMapLayouts)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  tempDir = mkdtempSync(join(tmpdir(), "risk-map-gc-"))
  originalStoragePath = process.env.STORAGE_PATH
  process.env.STORAGE_PATH = tempDir
  const { promises: fs } = await import("node:fs")
  await fs.mkdir(join(tempDir, "risk-map"), { recursive: true })

  await inMemoryDb.insert(schema.users).values({
    id: "u-miper", name: "Prevención", email: "prev@test", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-miper", name: "Faena MIPER", code: "MIP", isActive: true,
  })
})

afterEach(() => {
  process.env.STORAGE_PATH = originalStoragePath
  rmSync(tempDir, { recursive: true, force: true })
})

async function insertLayout(id: string, name: string, status: "active" | "archived") {
  await inMemoryDb.insert(schema.preventionRiskMapLayouts).values({
    id, worksiteId: "ws-miper", title: `Plano ${id}`,
    imagePath: `storage/risk-map/${name}`, imageMimeType: "image/png",
    status, createdByUserId: "u-miper",
  })
}

describe("cleanupRiskMapOrphans (MIP-002)", () => {
  it("elimina el plano que ninguna fila referencia y conserva los referenciados", async () => {
    const vigente = "plano-vigente.png"
    const archivado = "plano-archivado.png"
    const huerfano = "plano-huerfano.png"
    for (const name of [vigente, archivado, huerfano]) {
      writeFileSync(join(tempDir, "risk-map", name), "PNG")
      ageFile(join(tempDir, "risk-map", name))
    }
    await insertLayout("riskmap-1", vigente, "active")
    await insertLayout("riskmap-0", archivado, "archived")

    const { cleanupRiskMapOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupRiskMapOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.scanned).toBe(3)
    expect(result.deletedNames).toEqual([huerfano])
    expect(result.kept).toBe(2)

    // El plano ARCHIVADO no se toca: es evidencia histórica y su retención es
    // una decisión que la plataforma todavía no declara.
    expect(existsSync(join(tempDir, "risk-map", archivado))).toBe(true)
    expect(existsSync(join(tempDir, "risk-map", vigente))).toBe(true)
    expect(existsSync(join(tempDir, "risk-map", huerfano))).toBe(false)
  })

  it("respeta la ventana de gracia: el archivo recién subido aún no tiene fila", async () => {
    const recien = "plano-recien-subido.png"
    writeFileSync(join(tempDir, "risk-map", recien), "PNG")

    const { cleanupRiskMapOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupRiskMapOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.deleted).toBe(0)
    expect(existsSync(join(tempDir, "risk-map", recien))).toBe(true)
  })

  it("no borra nada en modo dryRun", async () => {
    const huerfano = "plano-dryrun.png"
    writeFileSync(join(tempDir, "risk-map", huerfano), "PNG")
    ageFile(join(tempDir, "risk-map", huerfano))

    const { cleanupRiskMapOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupRiskMapOrphans({ olderThanMs: 60 * 60 * 1000, dryRun: true })

    expect(result.deleted).toBe(1)
    expect(existsSync(join(tempDir, "risk-map", huerfano))).toBe(true)
  })

  it("el barrido de planos no toca el directorio de evidencia PDTP", async () => {
    const { promises: fs } = await import("node:fs")
    await fs.mkdir(join(tempDir, "pdtp-evidence"), { recursive: true })
    const evidencia = "acta-huerfana.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", evidencia), "PDF")
    ageFile(join(tempDir, "pdtp-evidence", evidencia))

    const { cleanupRiskMapOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    await cleanupRiskMapOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(existsSync(join(tempDir, "pdtp-evidence", evidencia))).toBe(true)
  })
})

/**
 * La otra mitad de MIP-002: la ruta que sirve la imagen buscaba por `imagePath`
 * y alcance de faena SIN MIRAR EL ESTADO. Un plano archivado se descargaba
 * exactamente igual que el vigente, y encima con `max-age=300`, así que podía
 * quedar cinco minutos en el caché del navegador ocupando el lugar del actual.
 *
 * Seguir sirviéndolo es deliberado —el histórico de planos es evidencia—;
 * servirlo INDISTINGUIBLE del vigente no lo es.
 */
describe("GET /api/prevencion/cgrd/mapa/[name] (MIP-002)", () => {
  async function get(name: string) {
    mockAuthFn.mockResolvedValue({
      user: {
        id: "u-miper", name: "Prevención", email: "prev@test",
        permissions: ["prevention:risk:view"], roles: ["prevencionista"],
        worksiteIds: [], isGlobal: true, isActive: true,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const { GET } = await import("@/app/api/prevencion/cgrd/mapa/[name]/route")
    const { NextRequest } = await import("next/server")
    return GET(
      new NextRequest(`http://localhost/api/prevencion/cgrd/mapa/${name}`),
      { params: Promise.resolve({ name }) },
    )
  }

  it("declara el plano vigente como vigente y lo deja cachear", async () => {
    const name = "plano-ruta-vigente.png"
    writeFileSync(join(tempDir, "risk-map", name), "PNG")
    await insertLayout("riskmap-ruta-1", name, "active")

    const response = await get(name)
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Plano-Estado")).toBe("vigente")
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300")
  })

  it("marca el plano archivado y no lo deja cachear", async () => {
    const name = "plano-ruta-archivado.png"
    writeFileSync(join(tempDir, "risk-map", name), "PNG")
    await insertLayout("riskmap-ruta-0", name, "archived")

    const response = await get(name)
    // Se sigue sirviendo a propósito: es evidencia histórica.
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Plano-Estado")).toBe("archivado")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })
})
