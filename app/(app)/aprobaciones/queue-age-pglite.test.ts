import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { approvalAgeDaysSql, approvalAgeFilterSql, loadApprovalAgeCounts } from "./queue-age"

/**
 * La edad de la cola se calcula en SQL —una sola vez, para la lista, los
 * contadores y el filtro— y por eso se prueba contra Postgres de verdad: la
 * zona horaria, el cast de un texto a `timestamptz` y el `group by` no se ven en
 * una prueba de JavaScript puro.
 *
 * Las tablas son mínimas a propósito (sólo las columnas que la consulta toca):
 * lo que se verifica es la aritmética de días, no el esquema.
 */

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB

// Martes 3-nov-2026 12:00 hora de Chile (UTC-3, horario de verano).
const NOW = new Date("2026-11-03T15:00:00Z")

const REQUESTS: Array<{ id: string; submittedAt: string | null; items?: number }> = [
  { id: "hoy", submittedAt: "2026-11-03T14:00:00Z" },
  { id: "ayer", submittedAt: "2026-11-02T14:00:00Z" },
  // 36,5 h atrás, pero a las 23:30 del 1-nov en Chile: 2 días civiles. Con horas
  // transcurridas (floor(h/24)) sería 1, y caería en el tramo equivocado.
  { id: "anteayer-madrugada", submittedAt: "2026-11-02T02:30:00Z" },
  { id: "tres", submittedAt: "2026-10-31T15:00:00Z", items: 2 },
  { id: "cuatro", submittedAt: "2026-10-30T15:00:00Z" },
  { id: "siete", submittedAt: "2026-10-27T15:00:00Z" },
  { id: "ocho", submittedAt: "2026-10-26T15:00:00Z", items: 3 },
  // Formato de `now()::text` (migración 0141): sin «T» y con «+00».
  { id: "formato-pg", submittedAt: "2026-10-20 12:34:56.789+00" },
  { id: "sin-fecha", submittedAt: null },
  { id: "fecha-vacia", submittedAt: "" },
  { id: "texto-basura", submittedAt: "no es una fecha" },
  // Reloj adelantado: nunca una edad negativa.
  { id: "futuro", submittedAt: "2026-11-04T10:00:00Z" },
]

async function ageOf(id: string, now: Date = NOW): Promise<number | null> {
  const [row] = await db
    .select({ age: approvalAgeDaysSql(now) })
    .from(schema.purchaseRequests)
    .where(eq(schema.purchaseRequests.id, id))
  return row?.age ?? null
}

beforeAll(async () => {
  await pg.exec(`
    create table purchase_requests (id text primary key, status text not null default 'submitted', submitted_at text);
    create table purchase_request_items (id text primary key, request_id text not null, status text not null);
  `)
  for (const request of REQUESTS) {
    await pg.query("insert into purchase_requests (id, submitted_at) values ($1, $2)", [request.id, request.submittedAt])
    for (let index = 0; index < (request.items ?? 1); index++) {
      await pg.query("insert into purchase_request_items (id, request_id, status) values ($1, $2, 'requested')", [`${request.id}-${index}`, request.id])
    }
  }
  // Un ítem ya decidido no es trabajo pendiente: no entra a ningún contador.
  await pg.query("insert into purchase_request_items (id, request_id, status) values ('hoy-decidido', 'hoy', 'approved')")
})

afterAll(async () => {
  await pg.close()
})

describe("approvalAgeDaysSql", () => {
  it.each([
    ["hoy", 0],
    ["ayer", 1],
    ["anteayer-madrugada", 2],
    ["tres", 3],
    ["cuatro", 4],
    ["siete", 7],
    ["ocho", 8],
    ["formato-pg", 14],
    ["futuro", 0],
  ])("%s tiene %i días civiles", async (id, days) => {
    expect(await ageOf(id)).toBe(days)
  })

  it("sin fecha de envío no hay edad (no se confunde con 0)", async () => {
    expect(await ageOf("sin-fecha")).toBeNull()
    expect(await ageOf("fecha-vacia")).toBeNull()
    // Un texto que no es una fecha no tumba la consulta de toda la cola.
    expect(await ageOf("texto-basura")).toBeNull()
  })

  it("cuenta días de Chile, no de UTC: a las 23:30 de Chile ya es el día siguiente en UTC", async () => {
    // Invierno (UTC-4): 14-jul 23:30 en Chile es 15-jul 03:30 en UTC. Enviada a
    // las 00:00 de Chile de ese mismo 14-jul, tiene 0 días; contando en UTC daría 1.
    const lateNight = new Date("2026-07-15T03:30:00Z")
    await pg.query("insert into purchase_requests (id, submitted_at) values ('invierno', '2026-07-14T04:00:00Z')")
    expect(await ageOf("invierno", lateNight)).toBe(0)
    // Un segundo antes de la medianoche chilena es todavía el día anterior.
    await pg.query("insert into purchase_requests (id, submitted_at) values ('medianoche', '2026-11-03T02:59:59Z')")
    expect(await ageOf("medianoche")).toBe(1)
    await pg.query("insert into purchase_requests (id, submitted_at) values ('pasada-medianoche', '2026-11-03T03:00:00Z')")
    expect(await ageOf("pasada-medianoche")).toBe(0)
  })
})

describe("approvalAgeFilterSql", () => {
  async function idsIn(key: Parameters<typeof approvalAgeFilterSql>[0]) {
    const rows = await db
      .select({ id: schema.purchaseRequests.id })
      .from(schema.purchaseRequests)
      .where(approvalAgeFilterSql(key, NOW))
    return rows.map((row) => row.id).filter((id) => REQUESTS.some((request) => request.id === id)).sort()
  }

  it("cada tramo trae sólo las solicitudes de su rango, con los bordes dentro", async () => {
    expect(await idsIn("0-1")).toEqual(["ayer", "futuro", "hoy"])
    expect(await idsIn("2-3")).toEqual(["anteayer-madrugada", "tres"])
    expect(await idsIn("4-7")).toEqual(["cuatro", "siete"])
    expect(await idsIn("mas-de-7")).toEqual(["formato-pg", "ocho"])
  })

  it("sin tramo no agrega condición", () => {
    expect(approvalAgeFilterSql("", NOW)).toBeUndefined()
  })

  it("una solicitud sin fecha no pasa ningún tramo", async () => {
    for (const key of ["0-1", "2-3", "4-7", "mas-de-7"] as const) {
      expect(await idsIn(key)).not.toContain("sin-fecha")
      expect(await idsIn(key)).not.toContain("fecha-vacia")
      expect(await idsIn(key)).not.toContain("texto-basura")
    }
  })
})

describe("loadApprovalAgeCounts", () => {
  it("cuenta ítems pendientes por tramo; los decididos y las solicitudes sin fecha no cuentan", async () => {
    const counts = await loadApprovalAgeCounts(db, inArray(schema.purchaseRequests.id, REQUESTS.map((request) => request.id)), NOW)
    expect(counts).toEqual({
      // hoy 1 + ayer 1 + futuro 1
      "0-1": 3,
      // anteayer-madrugada 1 + tres 2
      "2-3": 3,
      // cuatro 1 + siete 1
      "4-7": 2,
      // ocho 3 + formato-pg 1
      "mas-de-7": 4,
    })
  })

  it("el filtro que se le pasa acota el alcance, y el tramo elegido no lo reduce a sí mismo", async () => {
    // El gráfico cuenta con el alcance de la cola SIN el filtro de antigüedad:
    // si no, elegir un tramo dejaría los otros tres en cero.
    const onlyOldest = inArray(schema.purchaseRequests.id, ["ocho", "hoy"])
    expect(await loadApprovalAgeCounts(db, onlyOldest, NOW)).toEqual({ "0-1": 1, "2-3": 0, "4-7": 0, "mas-de-7": 3 })
  })
})
