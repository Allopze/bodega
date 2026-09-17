import { count, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpPrograms,
  preventionPdtpSourceLinks,
} from "@/db/schema"

const apply = process.argv.includes("--apply")

async function main() {
  const legacyObjectiveLinks = await db.select({
    id: preventionPdtpSourceLinks.id,
    activityId: preventionPdtpSourceLinks.activityId,
    sourceId: preventionPdtpSourceLinks.sourceId,
  }).from(preventionPdtpSourceLinks)
    .where(eq(preventionPdtpSourceLinks.sourceType, "internal_objective"))
  if (legacyObjectiveLinks.length > 0) {
    throw new Error(
      "No se puede aplicar la migración PDTP anual: aún existen vínculos source_type=internal_objective. " +
      `Revísalos y elimínalos o reclasifícalos antes de continuar: ${JSON.stringify(legacyObjectiveLinks)}`,
    )
  }

  // La identidad documental es año + versión. Una v2 abierta junto a la v1
  // activa es el estado esperado durante una revisión y nunca debe ser
  // eliminada por un script de compatibilidad anual.
  const duplicateYearVersions = await db.select({
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    total: count(),
  }).from(pdtpPrograms)
    .groupBy(pdtpPrograms.year, pdtpPrograms.version)
    .having(sql`count(*) > 1`)

  const duplicates = duplicateYearVersions.filter((row) => Number(row.total) > 1)
  if (duplicates.length === 0) {
    console.log(JSON.stringify({ ok: true, apply, legacyObjectiveLinks: legacyObjectiveLinks.length, duplicateYearVersions: [], removedProgramIds: [] }, null, 2))
    return
  }

  // Una duplicidad de la misma identidad es un estado imposible bajo el
  // índice vigente y requiere intervención explícita; no se elige una fila ni
  // se borra evidencia automáticamente.
  const duplicateKeys = duplicates.map((row) => ({
    year: row.year,
    version: row.version,
    total: Number(row.total),
  }))
  throw new Error(
    `Se detectaron programas con la misma identidad año + versión; no se eliminará ninguno automáticamente: ${JSON.stringify(duplicateKeys)}`,
  )
}

main().then(
  () => process.exit(0),
  (error) => {
    const cause = error instanceof Error ? error.cause : undefined
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : ""
    if (code === "42P01") {
      console.log(JSON.stringify({
        ok: true,
        apply,
        skipped: true,
        reason: "Las tablas PDTP aún no existen; corresponde a una base nueva y drizzle-kit puede crearlas.",
      }, null, 2))
      process.exit(0)
    }
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
