import { and, asc, eq, inArray, lt, or } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { enrichDteDocumentLines } from "@/lib/services/dte-portal/purchase-document-xml"

function numberArg(prefix: string, fallback: number) {
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const value = Number(raw ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error(`${prefix} debe estar entre 1 y 500`)
  return value
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Comando controlado: ejecuta primero db:preflight-dte-enrichment y luego agrega --apply")
  }
  const limit = numberArg("--limit=", 20)
  const period = process.argv.find((arg) => arg.startsWith("--period="))?.slice("--period=".length)
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("--period debe usar YYYY-MM")

  const documents = await db.query.dteDocuments.findMany({
    where: and(
      inArray(dteDocuments.tipoDte, ["33", "34"]),
      or(
        eq(dteDocuments.lineEnrichmentStatus, "pending"),
        and(eq(dteDocuments.lineEnrichmentStatus, "failed"), lt(dteDocuments.lineEnrichmentAttempts, 3)),
      ),
      period ? eq(dteDocuments.periodo, period) : undefined,
    ),
    columns: { id: true },
    orderBy: (document) => [asc(document.fechaEmision), asc(document.id)],
    limit,
  })

  const result = { selected: documents.length, ready: 0, failed: 0, errorCodes: {} as Record<string, number> }
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(2, documents.length) }, async () => {
    while (cursor < documents.length) {
      const document = documents[cursor]
      cursor += 1
      if (!document) continue
      const enrichment = await enrichDteDocumentLines(document.id)
      if (enrichment.ok) result.ready += 1
      else {
        result.failed += 1
        result.errorCodes[enrichment.errorCode] = (result.errorCodes[enrichment.errorCode] ?? 0) + 1
      }
    }
  }))

  console.log(JSON.stringify(result, null, 2))
}

// Sin `await` de nivel superior: el runner transpila a CJS y ahí el top-level
// await es un error de transformación, así que el script fallaba antes de
// abrir la conexión.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
