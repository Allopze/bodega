import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"
import * as schema from "../../db/schema"
import { assertDevSeedTarget, formatDevSeedTarget, type DevSeedTarget } from "./guard"

export type Db = PostgresJsDatabase<typeof schema>

export type SeedContext = {
  apply: boolean
  target: DevSeedTarget
  sql: Sql
  db: Db
  today: Date
  rng: () => number
  log: (message: string) => void
  actors: {
    adminUserId: string
    adminName: string
  }
  base: {
    worksites: (typeof schema.worksites.$inferSelect)[]
    workers: (typeof schema.workers.$inferSelect)[]
    products: (typeof schema.products.$inferSelect)[]
    suppliers: (typeof schema.suppliers.$inferSelect)[]
    fuelVehicles: (typeof schema.fuelVehicles.$inferSelect)[]
    fuelSuppliers: (typeof schema.fuelSuppliers.$inferSelect)[]
    fuelProducts: (typeof schema.fuelProducts.$inferSelect)[]
    costCenters: (typeof schema.costCenters.$inferSelect)[]
  }
}

export type SeedResult = {
  domain: string
  inserted: number
  skipped: number
  notes: string[]
}

export const DEV_SEED_PREFIX = "dev-"

/** PRNG determinista: dos corridas producen los mismos valores. */
export function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function int(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!
}

export function chance(rng: () => number, probability: number): boolean {
  return rng() < probability
}

export function daysAgo(reference: Date, days: number): Date {
  return new Date(reference.getTime() - days * 86_400_000)
}

export function iso(value: Date): string {
  return value.toISOString()
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function monthOnly(value: Date): string {
  return value.toISOString().slice(0, 7)
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000)
}

export function devId(area: string, sequence: number, width = 5): string {
  return `${DEV_SEED_PREFIX}${area}-${String(sequence).padStart(width, "0")}`
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function countRows(sql: Sql, table: string): Promise<number> {
  const [row] = await sql`select count(*)::int as count from ${sql(table)}`
  return Number(row?.count ?? 0)
}

/** Algunos módulos llegan antes que su migración a la base de desarrollo. */
export async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const [row] = await sql`
    select 1 as ok
    from information_schema.tables
    where table_schema = 'public' and table_name = ${table}
    limit 1
  `
  return Boolean(row)
}

/**
 * Inserta por lotes y devuelve cuántas filas entraron realmente. El callback
 * usa `onConflictDoNothing`, así que una segunda corrida informa 0 en vez de
 * duplicar datos.
 */
export async function insertInBatches<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<number>,
  batchSize = 500,
): Promise<number> {
  let inserted = 0
  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize)
    if (chunk.length === 0) continue
    inserted += await insert(chunk)
  }
  return inserted
}

export async function loadSeedContext(options: {
  apply: boolean
  log?: (message: string) => void
}): Promise<SeedContext> {
  const rawUrl = process.env.DATABASE_URL
  const target = assertDevSeedTarget(rawUrl, { apply: options.apply })
  const log = options.log ?? ((message: string) => console.log(message))
  const sql = postgres(rawUrl!, { max: 1 })
  const db = drizzle(sql, { schema })

  const admins = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(eq(schema.roles.name, "administrador"), eq(schema.users.isActive, true)))
    .limit(1)

  const fallback = admins[0]
    ? []
    : await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.isActive, true))
        .limit(1)

  const admin = admins[0] ?? fallback[0]
  if (!admin) {
    await sql.end({ timeout: 5 })
    throw new Error("No hay ningún usuario activo para actuar como autor de los datos de desarrollo.")
  }

  const [worksites, workers, products, suppliers, fuelVehicles, fuelSuppliers, fuelProducts, costCenters] =
    await Promise.all([
      db.select().from(schema.worksites).where(eq(schema.worksites.isActive, true)),
      db.select().from(schema.workers).where(eq(schema.workers.isActive, true)).limit(400),
      db.select().from(schema.products).where(eq(schema.products.isActive, true)).limit(250),
      db.select().from(schema.suppliers).where(eq(schema.suppliers.isActive, true)).limit(100),
      db.select().from(schema.fuelVehicles).limit(300),
      db.select().from(schema.fuelSuppliers).limit(50),
      db.select().from(schema.fuelProducts).limit(50),
      db.select().from(schema.costCenters).limit(100),
    ])

  log(`Destino de siembra: ${formatDevSeedTarget(target)} (${options.apply ? "APPLY" : "dry-run"})`)

  return {
    apply: options.apply,
    target,
    sql,
    db,
    today: new Date(),
    rng: mulberry32(20261104),
    log,
    actors: { adminUserId: admin.id, adminName: admin.name },
    base: { worksites, workers, products, suppliers, fuelVehicles, fuelSuppliers, fuelProducts, costCenters },
  }
}

export async function closeSeedContext(context: SeedContext): Promise<void> {
  await context.sql.end({ timeout: 5 })
}
