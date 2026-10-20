/**
 * Cifra las declaraciones RE-20 históricas antes de exponerlas bajo el permiso
 * nuevo de acceso sensible. El dry-run sólo cuenta filas, sin mostrar PII.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill-re20-statements.ts
 *   npx tsx --env-file-if-exists=.env.local scripts/backfill-re20-statements.ts --apply
 */
import { and, eq, isNull, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { preventionIncidentStatements } from "@/db/schema"
import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"

const apply = process.argv.includes("--apply")

async function main() {
  const pending = await db.select({
    id: preventionIncidentStatements.id,
    deponentName: preventionIncidentStatements.deponentName,
    deponentRole: preventionIncidentStatements.deponentRole,
    statementText: preventionIncidentStatements.statementText,
  }).from(preventionIncidentStatements).where(and(
    isNotNull(preventionIncidentStatements.statementText),
    isNull(preventionIncidentStatements.encryptedPayload),
  ))

  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", pendingStatements: pending.length, written: 0 }, null, 2))
    return
  }

  // Corre en cada `migrate`: sin filas pendientes no hay nada que cifrar, y no
  // debe exigir la clave (CI y entornos nuevos migran sin ella).
  if (pending.length === 0) {
    console.log(JSON.stringify({ mode: "applied", pendingStatements: 0, written: 0, plaintextRemaining: 0 }, null, 2))
    return
  }

  if (!process.env.PREVENTION_DATA_ENCRYPTION_KEY) {
    throw new Error("--apply requiere PREVENTION_DATA_ENCRYPTION_KEY; no se modificó ninguna declaración.")
  }

  const encryptedRows = pending.flatMap((row) => row.statementText === null ? [] : [{
    id: row.id,
    source: row.statementText,
    encrypted: encryptPreventionPayload({ name: row.deponentName, role: row.deponentRole, statement: row.statementText }, `incident-statement:${row.id}`),
  }])

  await db.transaction(async (tx) => {
    for (const row of encryptedRows) {
      const [updated] = await tx.update(preventionIncidentStatements).set({
        deponentName: null,
        deponentRole: null,
        statementText: null,
        encryptedPayload: row.encrypted.encryptedPayload,
        encryptedIv: row.encrypted.iv,
        encryptedAuthTag: row.encrypted.authTag,
        encryptedKeyVersion: row.encrypted.keyVersion,
      }).where(and(
        isNotNull(preventionIncidentStatements.statementText),
        isNull(preventionIncidentStatements.encryptedPayload),
        // Guard against a concurrent update since the report was assembled.
        // The plaintext itself never enters logs or output.
        eq(preventionIncidentStatements.id, row.id),
        eq(preventionIncidentStatements.statementText, row.source),
      )).returning({ id: preventionIncidentStatements.id })
      if (!updated) throw new Error("Una declaración cambió durante el cifrado; se revirtió el lote completo.")
    }
    const remaining = await tx.select({ id: preventionIncidentStatements.id }).from(preventionIncidentStatements).where(and(
      isNotNull(preventionIncidentStatements.statementText),
      isNull(preventionIncidentStatements.encryptedPayload),
    ))
    if (remaining.length > 0) throw new Error("La verificación posterior encontró declaraciones sin cifrar; se revirtió el lote completo.")
  })

  console.log(JSON.stringify({ mode: "applied", pendingStatements: pending.length, written: encryptedRows.length, plaintextRemaining: 0 }, null, 2))
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falló la migración RE-20 de declaraciones.")
    process.exit(1)
  },
)
