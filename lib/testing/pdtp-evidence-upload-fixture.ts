/**
 * PREV-M02-B (0334): fila del registro de subidas para un archivo de prueba,
 * como la deja `POST /api/prevencion/pdtp/evidence`. Sin ella,
 * `assertPdtpEvidenceLinkable` rechaza un archivo que todavía no referencia
 * ninguna fila. Las suites que no prueban la propiedad del archivo la usan para
 * declarar quién lo "subió" y para qué faena.
 *
 * Idempotente por ruta: si la fila ya existe, la reemplaza por la nueva
 * faena/usuario (las suites reinician la base por prueba y reutilizan nombres).
 */
import { sql } from "drizzle-orm"

type SqlClient = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }

export async function seedPdtpEvidenceUpload(
  client: SqlClient,
  input: { path: string; worksiteId: string; userId: string | null },
): Promise<void> {
  await client.execute(sql`
    insert into pdtp_evidence_uploads (path, uploaded_by_user_id, worksite_id, sha256, size_bytes, mime_type, created_at)
    values (${input.path}, ${input.userId}, ${input.worksiteId}, ${"0".repeat(64)}, 1, 'application/pdf', now())
    on conflict (path) do update set uploaded_by_user_id = excluded.uploaded_by_user_id, worksite_id = excluded.worksite_id
  `)
}
