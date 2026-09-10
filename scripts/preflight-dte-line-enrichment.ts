import postgres from "postgres"

export async function readDteLineEnrichmentPreflight(sql: postgres.Sql) {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    eligible: number
    pending: number
    failed_retryable: number
    failed_exhausted: number
    ready: number
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE tipo_dte IN ('33', '34'))::int AS eligible,
      COUNT(*) FILTER (WHERE tipo_dte IN ('33', '34') AND line_enrichment_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE tipo_dte IN ('33', '34') AND line_enrichment_status = 'failed' AND line_enrichment_attempts < 3)::int AS failed_retryable,
      COUNT(*) FILTER (WHERE tipo_dte IN ('33', '34') AND line_enrichment_status = 'failed' AND line_enrichment_attempts >= 3)::int AS failed_exhausted,
      COUNT(*) FILTER (WHERE tipo_dte IN ('33', '34') AND line_enrichment_status = 'ready')::int AS ready
    FROM dte_documents
  `)
  return {
    eligible: Number(report?.eligible ?? 0),
    pending: Number(report?.pending ?? 0),
    failedRetryable: Number(report?.failed_retryable ?? 0),
    failedExhausted: Number(report?.failed_exhausted ?? 0),
    ready: Number(report?.ready ?? 0),
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido. Este preflight sólo lee la base indicada.")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    console.log(JSON.stringify(await readDteLineEnrichmentPreflight(sql), null, 2))
  } finally {
    await sql.end()
  }
}

// Sin `await` de nivel superior: el runner transpila a CJS y ahí el top-level
// await es un error de transformación, así que el script fallaba antes de
// abrir la conexión.
if (process.argv[1]?.includes("preflight-dte-line-enrichment")) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
