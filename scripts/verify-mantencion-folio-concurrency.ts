/**
 * Verificación manual de folios bajo concurrencia real.
 *
 * PGlite serializa las transacciones, así que la prueba de 20 folios de la
 * suite no demuestra la carrera. Este script corre 20 transacciones en paralelo
 * contra un Postgres real y exige 20 folios únicos y consecutivos.
 *
 *   MANT_CONCURRENCY_DATABASE_URL=postgres://… npx tsx scripts/verify-mantencion-folio-concurrency.ts
 *
 * Nunca usa `DATABASE_URL` como respaldo: apuntar esto a producción crearía una
 * faena y un contador de prueba.
 */
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../db/schema"

const url = process.env.MANT_CONCURRENCY_DATABASE_URL?.trim()
if (!url) {
  throw new Error("Falta MANT_CONCURRENCY_DATABASE_URL (base desechable, nunca DATABASE_URL).")
}
if (url === process.env.DATABASE_URL?.trim()) {
  throw new Error("MANT_CONCURRENCY_DATABASE_URL no puede ser la misma que DATABASE_URL.")
}

const CONCURRENT = 20
const KIND = "P" as const
const worksiteId = "ws-mant-concurrency"
const worksiteCode = `ZZQ-${String(Date.now()).slice(-6)}`

const client = postgres(url, { max: CONCURRENT + 5 })
const db = drizzle(client, { schema })

function folioNumber(folio: string) {
  return Number.parseInt(folio.slice(folio.lastIndexOf("-") + 1), 10)
}

async function cleanup() {
  await db.delete(schema.mantFolioCounters)
    .where(and(eq(schema.mantFolioCounters.worksiteId, worksiteId), eq(schema.mantFolioCounters.kind, KIND)))
  await db.delete(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, worksiteId))
  await db.delete(schema.worksites).where(eq(schema.worksites.id, worksiteId))
}

async function main() {
  // `@/db` lee DATABASE_URL al evaluarse. Se fija recién aquí y los servicios
  // se importan después, para que el proceso no dependa de un DATABASE_URL
  // externo (y no pueda apuntar a producción por accidente).
  process.env.DATABASE_URL = url
  const [{ nextFolio }, { ensureFolioCode }] = await Promise.all([
    import("../lib/services/mantencion/folio"),
    import("../lib/services/mantencion/worksites"),
  ])
  try {
    await cleanup()
    await db.insert(schema.worksites).values({
      id: worksiteId,
      name: "Concurrencia de folios (verificación)",
      code: worksiteCode,
      isActive: true,
    })
    const folioCode = await db.transaction((tx) => ensureFolioCode(tx, worksiteId, "ZZQ"))

    const folios = await Promise.all(
      Array.from({ length: CONCURRENT }, () => db.transaction((tx) => nextFolio(tx, worksiteId, KIND))),
    )
    const numbers = folios.map(folioNumber).sort((left, right) => left - right)
    const expected = Array.from({ length: CONCURRENT }, (_, index) => index + 1)

    if (new Set(folios).size !== CONCURRENT) throw new Error(`Folios repetidos: ${folios.join(", ")}`)
    if (numbers.join(",") !== expected.join(",")) throw new Error(`Folios no consecutivos: ${numbers.join(", ")}`)

    console.log(`OK: ${CONCURRENT} folios únicos y consecutivos con prefijo M${KIND}-${folioCode}-.`)
  } finally {
    await cleanup()
    await client.end()
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
