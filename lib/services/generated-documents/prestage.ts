/**
 * Deja lista para subir una fila cuyo archivo ya se armó en otro lado: el acta
 * SST se imprime una sola vez al cerrarse, para Documentación y para esta
 * copia. Así la fila no depende de volver a imprimirla con una sesión.
 *
 * Módulo liviano a propósito: lo importa `lib/services/sst-module`, y el
 * procesador completo (`./drain`) arrastra los armadores de todos los tipos.
 */
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { generatedDocumentArchives } from "@/db/schema"
import { GENERATED_DOCUMENT_KIND_SPECS, hasExpectedSignature, isGeneratedDocumentKind } from "./kinds"
import { sanitizeRemoteFileName } from "./remote-key"
import { writeStagedDocument } from "./staging"

export async function stageRenderedGeneratedDocument(id: string, buffer: Buffer, baseName: string): Promise<void> {
  const [row] = await db.select().from(generatedDocumentArchives).where(eq(generatedDocumentArchives.id, id)).limit(1)
  if (!row || row.status !== "pending" || !isGeneratedDocumentKind(row.kind)) return
  const spec = GENERATED_DOCUMENT_KIND_SPECS[row.kind]
  if (!hasExpectedSignature(buffer, spec.extension)) throw new Error("El archivo no tiene la firma esperada")
  await writeStagedDocument(row.id, spec.extension, buffer)
  const now = new Date().toISOString()
  await db.update(generatedDocumentArchives).set({
    status: "staged",
    fileName: sanitizeRemoteFileName(baseName, spec.extension),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.length,
    stagedAt: now,
    updatedAt: now,
  }).where(eq(generatedDocumentArchives.id, row.id))
}
