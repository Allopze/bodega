/**
 * lib/__tests__/prevention-capa-evidence-file.test.ts
 *
 * Evidencia subida desde la propia CAPA (`storage/capa-evidence/`). La subida
 * calcula el SHA-256 en el servidor, pero `addCapaEvidence` recibía de vuelta
 * la ruta y el checksum desde el cliente y los guardaba tal cual: bastaba
 * inventar un checksum —o apuntar a un archivo que no existe— para que el
 * contrato de evidencia diera por buena una foto o un acta. Y la ruta de la
 * faena A podía vincularse a una CAPA de la faena B.
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const previousStoragePath = process.env.STORAGE_PATH
const tmpRoot = join(tmpdir(), `capa-evidence-file-${Date.now()}`)
process.env.STORAGE_PATH = tmpRoot
mkdirSync(join(tmpRoot, "capa-evidence"), { recursive: true })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const { addCapaEvidence } = await import("@/lib/services/prevention-capa")

const WS_A = "ws-capa-file-a"
const WS_B = "ws-capa-file-b"
const USER_A = "user-capa-file-a"
const USER_B = "user-capa-file-b"

/** Un archivo como lo deja `POST /api/prevencion/capa/evidence`: ruta y su SHA-256 real. */
function uploaded(name: string, content = `%PDF-1.4 ${name}`) {
  writeFileSync(join(tmpRoot, "capa-evidence", name), content)
  return {
    reference: `storage/capa-evidence/${name}`,
    checksumSha256: createHash("sha256").update(content).digest("hex"),
  }
}

async function capaAction(id: string, worksiteId: string, userId: string) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionCapaActions).values({
    id, code: `CAPA-${id}`, sourceType: "manual", sourceId: id,
    worksiteId, finding: "Hallazgo", actionDescription: "Acción",
    targetDate: "2026-12-01", createdByUserId: userId, createdAt: now, updatedAt: now,
  })
}

function add(actionId: string, worksiteId: string, userId: string, evidence: { reference: string; checksumSha256: string }) {
  return addCapaEvidence({
    input: { actionId, expectedVersion: 1, kind: "document", ...evidence },
    ctx: { userId } as never,
    scope: { mode: "some", ids: [worksiteId] },
    permissions: ["prevention:capa:complete"],
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values([USER_A, USER_B].map((id) => ({
    id, name: `Nombre ${id}`, email: `${id}@test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "CFA", isActive: true },
    { id: WS_B, name: "Faena B", code: "CFB", isActive: true },
  ])
  await capaAction("capa-a", WS_A, USER_A)
  await capaAction("capa-b", WS_B, USER_B)
})

describe("evidencia de CAPA subida desde la plataforma", () => {
  it("se acepta con el checksum real del archivo", async () => {
    const file = uploaded("acta-real.pdf")
    await expect(add("capa-a", WS_A, USER_A, file)).resolves.toMatchObject({ evidence: { reference: file.reference } })
  })

  it("se rechaza si el checksum no corresponde al archivo guardado", async () => {
    const file = uploaded("acta-alterada.pdf")
    await expect(add("capa-a", WS_A, USER_A, { ...file, checksumSha256: "b".repeat(64) }))
      .rejects.toThrow(/no corresponde/i)
    expect(await inMemoryDb.select().from(schema.preventionCapaEvidence)).toHaveLength(0)
  })

  it("se rechaza si el archivo no está en el almacenamiento", async () => {
    await expect(add("capa-a", WS_A, USER_A, {
      reference: "storage/capa-evidence/inexistente.pdf", checksumSha256: "c".repeat(64),
    })).rejects.toThrow(/no está en el almacenamiento/i)
  })

  it("un archivo ya vinculado a una CAPA de otra faena no se adopta desde aquí", async () => {
    const file = uploaded("acta-faena-a.pdf")
    await add("capa-a", WS_A, USER_A, file)
    await expect(add("capa-b", WS_B, USER_B, file)).rejects.toThrow(/otra faena/i)
    const evidenceB = await inMemoryDb.select().from(schema.preventionCapaEvidence)
      .where(eq(schema.preventionCapaEvidence.actionId, "capa-b"))
    expect(evidenceB).toHaveLength(0)
  })
})
