export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { MimeType, validateFileBuffer } from "@/lib/file-validation"
import { logger } from "@/lib/logger"
import { safeActionMessage } from "@/lib/action-error"
import { addFindingEvidence, assertFindingEvidenceUploadAllowed, assertInspectionOperationEnabled } from "@/lib/services/prevention-inspections"
import { generateStorageName } from "@/lib/services/prevention-documents/utils"
import { createInspectionEvidencePath, resolveInspectionEvidenceDir, resolveStorageFile } from "@/lib/storage/config"
import { mkdirp, writeBuffer } from "@/lib/storage/helpers"

const MAX_FILE_SIZE = 25 * 1024 * 1024

export async function POST(request: Request) {
  const guard = await guardPermission("prevention:inspections:execute")
  if (guard.error) return NextResponse.json(guard.error, { status: 403 })
  try {
    const form = await request.formData()
    const file = form.get("file")
    const findingId = String(form.get("findingId") ?? "")
    const caption = String(form.get("caption") ?? "").trim() || null
    if (!(file instanceof File) || !findingId) {
      return NextResponse.json({ error: "Faltan el archivo o el hallazgo." }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "El archivo supera 25 MB." }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const validated = validateFileBuffer(bytes, file.size, MimeType.PROOF, file.name)
    if (validated.error) return NextResponse.json({ error: validated.error }, { status: 400 })

    await assertInspectionOperationEnabled()
    const session = guard.session!
    const access = {
      userId: session.user.id,
      scope: resolveWorksiteScope(session),
      permissions: session.user.permissions,
    }
    await assertFindingEvidenceUploadAllowed(findingId, access)
    const storageName = generateStorageName(file.name)
    const dir = resolveInspectionEvidenceDir()
    await mkdirp(dir)
    await writeBuffer(resolveStorageFile(dir, storageName), Buffer.from(bytes))
    const relativePath = createInspectionEvidencePath(storageName)
    const created = await addFindingEvidence({
      findingId,
      path: relativePath,
      fileName: file.name,
      mimeType: validated.mimeType ?? file.type,
      fileSize: file.size,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      caption,
    }, access)
    return NextResponse.json({ id: created.id, path: created.path, caption: created.caption }, { status: 201 })
  } catch (error) {
    logger.error("[inspecciones/finding-evidence]", error)
    return NextResponse.json({ error: safeActionMessage(error, "No se pudo subir la evidencia.") }, { status: 400 })
  }
}
