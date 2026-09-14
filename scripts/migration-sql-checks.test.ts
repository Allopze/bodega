/**
 * DAT-002 — La verificación de la cadena de migraciones no inspeccionaba el SQL.
 *
 * `verify-migration-chain.mjs` comprobaba que el journal y los archivos
 * coincidieran (índices contiguos, tags únicos, timestamps crecientes, prefijo
 * alineado con el idx) y el propio preflight citaba la limitación: *"This does
 * not inspect the SQL"*. Con casi 300 migraciones acumuladas, la única barrera
 * automática era de forma, no de contenido.
 *
 * Estas pruebas cubren las TRES comprobaciones de contenido que se agregaron y
 * —tanto o más importante— los casos que NO deben disparar ninguna. El criterio
 * de admisión fue que cada comprobación sea objetiva y no pueda producir un
 * falso positivo: un verificador que cría falsos positivos se desactiva en la
 * primera urgencia de deploy y deja de proteger nada.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { compareChecksums, findUnguardedDrops, isEffectivelyEmpty, sqlChecksum, stripSqlNoise } from "./migration-sql-checks.mjs"

const root = process.cwd()

describe("DAT-002 · 1. inmutabilidad de una migración publicada", () => {
  it("detecta una migración ya publicada que fue reescrita", () => {
    const manifest = { "0001_uno": "aaa", "0002_dos": "bbb" }
    const actual = { "0001_uno": "aaa", "0002_dos": "REESCRITA" }
    // Reescribir un archivo que producción ya aplicó no vuelve a ejecutarlo:
    // la base queda en un estado que el repo ya no describe, en silencio.
    expect(compareChecksums(manifest, actual).changed).toEqual(["0002_dos"])
  })

  it("una migración NUEVA no es un error: dos ramas paralelas no se bloquean", () => {
    const diff = compareChecksums({ "0001_uno": "aaa" }, { "0001_uno": "aaa", "0002_dos": "bbb" })
    expect(diff.changed).toEqual([])
    expect(diff.added).toEqual(["0002_dos"])
  })

  it("una migración publicada que desaparece del árbol sí lo es", () => {
    expect(compareChecksums({ "0001_uno": "aaa" }, {}).missing).toEqual(["0001_uno"])
  })

  it("el checksum ignora CRLF: un cambio de fin de línea no es un cambio de migración", () => {
    expect(sqlChecksum("DROP TABLE IF EXISTS x;\r\n")).toBe(sqlChecksum("DROP TABLE IF EXISTS x;\n"))
  })

  it("el manifiesto del repo describe exactamente las migraciones del journal", () => {
    const journal = JSON.parse(readFileSync(path.join(root, "db/migrations/meta/_journal.json"), "utf8"))
    const manifest = JSON.parse(readFileSync(path.join(root, "db/migrations/meta/_sql-checksums.json"), "utf8"))
    const tags: string[] = journal.entries.map((entry: { tag: string }) => entry.tag)
    const actual = Object.fromEntries(
      tags.map((tag) => [tag, sqlChecksum(readFileSync(path.join(root, "db/migrations", `${tag}.sql`), "utf8"))]),
    )
    const diff = compareChecksums(manifest, actual)
    expect(diff.changed).toEqual([])
    expect(diff.missing).toEqual([])
  })
})

describe("DAT-002 · 2. DROP sin guarda", () => {
  it("marca el DROP de un objeto sin IF EXISTS", () => {
    // Sin la guarda, la migración aborta el deploy entero si el objeto ya no
    // está —bases restauradas de respaldos parciales, entornos divergidos— y
    // deja de ser reaplicable.
    expect(findUnguardedDrops("DROP TABLE facturas;")).toEqual(["DROP TABLE"])
    expect(findUnguardedDrops('ALTER TABLE "x" DROP CONSTRAINT "x_fk";')).toEqual(["DROP CONSTRAINT"])
    expect(findUnguardedDrops("DROP INDEX CONCURRENTLY idx_x;")).toEqual(["DROP INDEX CONCURRENTLY"])
  })

  it("no marca el DROP guardado", () => {
    expect(findUnguardedDrops('DROP TABLE IF EXISTS "facturas";')).toEqual([])
    expect(findUnguardedDrops('ALTER TABLE "x" DROP COLUMN IF EXISTS "y";')).toEqual([])
  })

  it("no marca lo que no borra un objeto: son cambios de atributo sin IF EXISTS posible", () => {
    // Falso positivo evidente si se buscara `DROP` a secas.
    expect(findUnguardedDrops('ALTER TABLE "x" ALTER COLUMN "y" DROP NOT NULL;')).toEqual([])
    expect(findUnguardedDrops('ALTER TABLE "x" ALTER COLUMN "y" DROP DEFAULT;')).toEqual([])
    expect(findUnguardedDrops('ALTER TABLE "x" ALTER COLUMN "y" DROP IDENTITY IF EXISTS;')).toEqual([])
  })

  it("no marca un DROP que sólo se menciona en un comentario o en un literal", () => {
    expect(findUnguardedDrops("-- antes esto hacía DROP TABLE facturas\nSELECT 1;")).toEqual([])
    expect(findUnguardedDrops("/* DROP TABLE facturas */ SELECT 1;")).toEqual([])
    expect(findUnguardedDrops("INSERT INTO log (msg) VALUES ('DROP TABLE facturas');")).toEqual([])
    expect(findUnguardedDrops("CREATE FUNCTION f() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;")).toEqual([])
  })

  it("el árbol actual no supera la cota heredada declarada en el verificador", () => {
    const script = readFileSync(path.join(root, "scripts/verify-migration-chain.mjs"), "utf8")
    const baseline = Number(/const LEGACY_UNGUARDED_DROPS = (\d+)/.exec(script)?.[1])
    expect(Number.isInteger(baseline)).toBe(true)

    const journal = JSON.parse(readFileSync(path.join(root, "db/migrations/meta/_journal.json"), "utf8"))
    let total = 0
    for (const entry of journal.entries as { tag: string }[]) {
      total += findUnguardedDrops(
        readFileSync(path.join(root, "db/migrations", `${entry.tag}.sql`), "utf8"),
      ).length
    }
    expect(total).toBeLessThanOrEqual(baseline)
  })
})

describe("DAT-002 · 3. migración vacía", () => {
  it("detecta el .sql sin una sola sentencia ejecutable", () => {
    // Una entrada del journal cuyo SQL se perdió es un error de empaquetado,
    // no un no-op deliberado.
    expect(isEffectivelyEmpty("-- COB-999 pendiente\n\n")).toBe(true)
    expect(isEffectivelyEmpty("/* nada todavía */\n;\n")).toBe(true)
    expect(isEffectivelyEmpty("--> statement-breakpoint\n")).toBe(true)
  })

  it("no marca vacía una migración con contenido", () => {
    expect(isEffectivelyEmpty('-- comentario\nALTER TABLE "x" ADD COLUMN "y" text;')).toBe(false)
  })
})

describe("DAT-002 · el verificador usa realmente las tres comprobaciones", () => {
  it("verify-migration-chain.mjs importa y ejecuta el módulo de inspección", () => {
    // La regla correcta sin conectar no arregla nada: el hallazgo era que el
    // verificador no miraba el SQL, no que faltaran funciones para mirarlo.
    const script = readFileSync(path.join(root, "scripts/verify-migration-chain.mjs"), "utf8")
    expect(script).toContain('from "./migration-sql-checks.mjs"')
    for (const call of ["compareChecksums(", "findUnguardedDrops(", "isEffectivelyEmpty(", "sqlChecksum("]) {
      expect(script).toContain(call)
    }
  })
})

describe("stripSqlNoise", () => {
  it("conserva el SQL y borra comentarios, literales y cuerpos $$", () => {
    expect(stripSqlNoise("SELECT 1; -- x\nSELECT 2;")).toContain("SELECT 2;")
    expect(stripSqlNoise("SELECT 'a''b';")).not.toContain("a")
  })
})
