import { PGlite } from "@electric-sql/pglite"
import { promises as fs } from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { splitSqlStatements } from "@/lib/testing/pglite-migrate"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"

const pg = new PGlite()
let migrationSql = ""

async function loadWorkerPositionMigration(): Promise<string> {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations")
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()

  const matches: string[] = []
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8")
    if (sql.includes('CREATE TABLE "worker_positions"')) matches.push(sql)
  }

  expect(matches, "debe existir una única migración del catálogo de cargos").toHaveLength(1)
  return matches[0] ?? ""
}

/** Base nueva con el padrón legado indicado y la migración ya aplicada. */
async function buildMigratedDb(workerRows: Array<[string, string | null]>): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE worksites (id text PRIMARY KEY);
    CREATE TABLE workers (
      id text PRIMARY KEY,
      position text,
      worksite_id text NOT NULL REFERENCES worksites(id),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO worksites (id) VALUES ('faena-1');
  `)
  for (const [id, position] of workerRows) {
    await db.query("INSERT INTO workers (id, position, worksite_id) VALUES ($1, $2, 'faena-1')", [id, position])
  }
  for (const statement of splitSqlStatements(await loadWorkerPositionMigration())) {
    await db.exec(statement)
  }
  return db
}

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE worksites (id text PRIMARY KEY);
    CREATE TABLE workers (
      id text PRIMARY KEY,
      position text,
      worksite_id text NOT NULL REFERENCES worksites(id),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO worksites (id) VALUES ('faena-1');
    INSERT INTO workers (id, position, worksite_id) VALUES
      ('worker-1', 'Operador', 'faena-1'),
      ('worker-2', ' operador ', 'faena-1'),
      ('worker-3', 'Técnico / Eléctrico', 'faena-1'),
      ('worker-4', NULL, 'faena-1');
  `)

  migrationSql = await loadWorkerPositionMigration()
  for (const statement of splitSqlStatements(migrationSql)) {
    await pg.exec(statement)
  }
})

afterAll(async () => { await pg.close() })

describe("migración del catálogo de cargos", () => {
  it("unifica variantes y asigna Sin clasificar sin borrar el texto legado", async () => {
    const result = await pg.query<{
      id: string
      legacy_position: string | null
      name: string
      normalized_key: string
      needs_review: boolean
    }>(`
      SELECT w.id,
             w.position AS legacy_position,
             p.name,
             p.normalized_key,
             p.needs_review
      FROM workers w
      JOIN worker_positions p ON p.id = w.position_id
      ORDER BY w.id
    `)

    expect(result.rows).toEqual([
      {
        id: "worker-1",
        legacy_position: "Operador",
        name: "Operador",
        normalized_key: "operador",
        needs_review: true,
      },
      {
        id: "worker-2",
        legacy_position: " operador ",
        name: "Operador",
        normalized_key: "operador",
        needs_review: true,
      },
      {
        id: "worker-3",
        legacy_position: "Técnico / Eléctrico",
        name: "Técnico / Eléctrico",
        normalized_key: "tecnico electrico",
        needs_review: true,
      },
      {
        id: "worker-4",
        legacy_position: null,
        name: "Sin clasificar",
        // El cargo de sistema no se revisa: su badge nunca podría limpiarse.
        normalized_key: "sin clasificar",
        needs_review: false,
      },
    ])
  })

  it("crea capacidades iniciales sin asignarlas a cargos pendientes", async () => {
    const capabilities = await pg.query<{ code: string }>(
      "SELECT code FROM worker_capabilities ORDER BY code",
    )
    const assignments = await pg.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM worker_position_capabilities",
    )

    expect(capabilities.rows).toEqual([
      { code: "drives_vehicle" },
      { code: "operates_equipment" },
    ])
    expect(assignments.rows[0]?.count).toBe(0)
  })

  it("registra una sola fila histórica por trabajador durante el backfill", async () => {
    const marker = "-- worker-position-backfill:start"
    const backfillSql = migrationSql.slice(migrationSql.indexOf(marker))
    expect(backfillSql.startsWith(marker)).toBe(true)
    for (const statement of splitSqlStatements(backfillSql)) {
      await pg.exec(statement)
    }

    const history = await pg.query<{ worker_id: string; source: string }>(
      "SELECT worker_id, source FROM worker_position_history ORDER BY worker_id",
    )

    expect(history.rows).toEqual([
      { worker_id: "worker-1", source: "migration" },
      { worker_id: "worker-2", source: "migration" },
      { worker_id: "worker-3", source: "migration" },
      { worker_id: "worker-4", source: "migration" },
    ])
  })
})

describe("migración del catálogo de cargos — textos legados fuera de rango", () => {
  /** `worker_positions` exige 2..120 en `name` y `normalized_key`. El texto
   *  libre nunca tuvo ese tope, así que la migración debe absorberlo en vez de
   *  abortar el deploy completo. */
  const CARGO_LARGO = "X".repeat(180)
  const CAPATAZ_CON_RELLENO = `Capataz${"-".repeat(200)}`

  let db: PGlite

  beforeAll(async () => {
    db = await buildMigratedDb([
      ["worker-ordinal", "Jefe 1º Turno"],
      ["worker-corto", "A"],
      ["worker-largo", CARGO_LARGO],
      ["worker-relleno", CAPATAZ_CON_RELLENO],
    ])
  })

  afterAll(async () => { await db.close() })

  it("deja a todo trabajador con un cargo asignado", async () => {
    const huerfanos = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM workers WHERE position_id IS NULL",
    )
    expect(huerfanos.rows[0]?.count).toBe(0)
  })

  it("manda a Sin clasificar lo que no cabe en el catálogo y recorta lo que sí", async () => {
    const filas = await db.query<{ id: string; name: string; normalized_key: string }>(`
      SELECT w.id, p.name, p.normalized_key
      FROM workers w JOIN worker_positions p ON p.id = w.position_id
      ORDER BY w.id
    `)
    const porId = new Map(filas.rows.map((f) => [f.id, f]))

    // Clave de 1 carácter y clave de 180: ninguna cabe, ambas caen al sistema.
    expect(porId.get("worker-corto")?.normalized_key).toBe("sin clasificar")
    expect(porId.get("worker-largo")?.normalized_key).toBe("sin clasificar")

    // Acá la clave sí cabe ("capataz"); lo que sobra es el nombre visible.
    expect(porId.get("worker-relleno")?.normalized_key).toBe("capataz")
    expect(porId.get("worker-relleno")?.name).toHaveLength(120)
  })

  it("normaliza los ordinales igual que el normalizador de la aplicación", async () => {
    const fila = await db.query<{ normalized_key: string }>(`
      SELECT p.normalized_key FROM workers w
      JOIN worker_positions p ON p.id = w.position_id WHERE w.id = 'worker-ordinal'
    `)
    expect(fila.rows[0]?.normalized_key).toBe(normalizeWorkerPositionKey("Jefe 1º Turno"))
    expect(fila.rows[0]?.normalized_key).toBe("jefe 1o turno")
  })

  it("registra también el backfill de los que cayeron en Sin clasificar", async () => {
    const history = await db.query<{ worker_id: string }>(
      "SELECT worker_id FROM worker_position_history ORDER BY worker_id",
    )
    expect(history.rows.map((f) => f.worker_id)).toEqual([
      "worker-corto", "worker-largo", "worker-ordinal", "worker-relleno",
    ])
  })
})

describe("normalizador SQL vs normalizador TypeScript", () => {
  /** El backfill agrupa en SQL y la aplicación resuelve en TypeScript. Si las
   *  dos implementaciones se separan, el mismo cargo nace dos veces: una por el
   *  backfill y otra en la siguiente importación. Este corpus es el guardián. */
  const CORPUS = [
    "Operador", "  operador  ", "OPERADOR DE GRÚA", "Técnico / Eléctrico",
    "Señalero", "Cañería", "Ñuñoa", "Eléctrico", "Chofer-Ayudante",
    "Jefe 1º Turno", "Jefe 1ª Línea", "Operador Nº 2", "Maestro 2º Nivel",
    "Supervisor(a)", "Jefe de Área", "Capataz", "Rigger", "Prevencionista",
    "Ayudante   de    Bodega", "Conductor A-2", "Operario 3º", "—", "***",
    // Descomposiciones de compatibilidad que un `translate` no puede expandir
    // 1→N. Llegan al padrón pegadas desde un PDF o un ERP, y el normalizador
    // nativo NFKD las pliega igual que el de la aplicación.
    "ﬁnanzas", "Ｏｐｅｒａｄｏｒ", "½ jornada", "Ⅳ Turno", "Ｊｅｆｅ  Ｔｕｒｎｏ",
  ]

  let db: PGlite

  beforeAll(async () => {
    // La migración elimina la función tras el backfill; se recrea tal cual la
    // define para poder contrastarla.
    db = new PGlite()
    const sql = await loadWorkerPositionMigration()
    const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION normalize_worker_position_key")
    const fin = sql.indexOf("$$;", inicio) + "$$;".length
    expect(inicio, "la migración debe definir normalize_worker_position_key").toBeGreaterThan(-1)
    await db.exec(sql.slice(inicio, fin))
  })

  afterAll(async () => { await db.close() })

  it("produce la misma clave para todo el corpus", async () => {
    const divergencias: Array<{ entrada: string; sql: string | null; ts: string }> = []
    for (const entrada of CORPUS) {
      const fila = await db.query<{ k: string | null }>(
        "SELECT normalize_worker_position_key($1::text) AS k", [entrada],
      )
      const sqlKey = fila.rows[0]?.k ?? null
      const tsKey = normalizeWorkerPositionKey(entrada)
      // La función SQL devuelve NULL donde el normalizador TS devuelve "".
      if ((sqlKey ?? "") !== tsKey) divergencias.push({ entrada, sql: sqlKey, ts: tsKey })
    }
    expect(divergencias).toEqual([])
  })
})
