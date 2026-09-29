/**
 * Evidencia subida de Prevención (Campañas, CGRD, Higiene, CAPA) para pruebas.
 *
 * PRV-01 (auditoría 2026-09-28): esos módulos ya no aceptan una URL ni una ruta
 * cualquiera; el acto reclama un archivo que la plataforma registró al subirlo
 * (`prevention_evidence_uploads`). Este fixture deja el archivo en disco y su
 * fila sin reclamar —el estado exacto en que la deja la ruta de subida—, así
 * que la prueba ejercita el reclamo real. Requiere `STORAGE_PATH` apuntando a
 * un directorio temporal.
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { nanoid } from "@/lib/id"
import * as schema from "@/db/schema"
import {
  resolveCampaignEvidenceDir,
  resolveCapaEvidenceDir,
  resolveCgrdEvidenceDir,
  resolveHygieneEvidenceDir,
} from "@/lib/storage/config"

type Domain = "campaign" | "cgrd" | "hygiene" | "capa"

const DIRS: Record<Domain, { dir: () => string; prefix: string }> = {
  campaign: { dir: resolveCampaignEvidenceDir, prefix: "storage/campaign-evidence" },
  cgrd: { dir: resolveCgrdEvidenceDir, prefix: "storage/cgrd-evidence" },
  hygiene: { dir: resolveHygieneEvidenceDir, prefix: "storage/hygiene-evidence" },
  capa: { dir: resolveCapaEvidenceDir, prefix: "storage/capa-evidence" },
}

type InsertClient = { insert: (table: typeof schema.preventionEvidenceUploads) => { values: (row: typeof schema.preventionEvidenceUploads.$inferInsert) => Promise<unknown> } }

export async function seedPreventionEvidenceUpload(
  client: InsertClient,
  input: { domain: Domain; uploadedByUserId: string; name?: string },
): Promise<string> {
  const { dir, prefix } = DIRS[input.domain]
  const name = input.name ?? `${nanoid(20)}.pdf`
  const content = `%PDF-1.4 ${name}`
  mkdirSync(dir(), { recursive: true })
  writeFileSync(path.join(dir(), name), content)
  await client.insert(schema.preventionEvidenceUploads).values({
    path: `${prefix}/${name}`,
    domain: input.domain,
    uploadedByUserId: input.uploadedByUserId,
    worksiteId: null,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
    mimeType: "application/pdf",
    createdAt: new Date().toISOString(),
  })
  return `${prefix}/${name}`
}
