import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { classifyPdtpExecutionEvidence } from "./audit-dossier-evidence"

const previousStoragePath = process.env.STORAGE_PATH
const root = join(tmpdir(), `pdtp-dossier-evidence-${Date.now()}`)
process.env.STORAGE_PATH = root
mkdirSync(join(root, "pdtp-evidence"), { recursive: true })
writeFileSync(join(root, "pdtp-evidence", "existe.pdf"), "%PDF-1.4")

afterAll(() => {
  if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
  else process.env.STORAGE_PATH = previousStoragePath
})

const base = { origin: "manual", sourceId: null, evidenceUrl: null, evidencePhotos: [], evidenceText: null }

describe("classifyPdtpExecutionEvidence (PREV-I06)", () => {
  it("un archivo que existe en disco es evidencia verificada", () => {
    expect(classifyPdtpExecutionEvidence({ ...base, evidenceUrl: "storage/pdtp-evidence/existe.pdf" })).toBe("file")
  })

  it("una referencia a un archivo que ya no existe no se declara como evidencia", () => {
    expect(classifyPdtpExecutionEvidence({ ...base, evidenceUrl: "storage/pdtp-evidence/borrado.pdf" })).toBe("missing_file")
  })

  it("sólo texto es una declaración, no evidencia verificada", () => {
    expect(classifyPdtpExecutionEvidence({ ...base, evidenceText: "Migrado sin evidencia adjunta" })).toBe("declaration")
  })

  it("una acreditación por integración se respalda en su registro de origen", () => {
    expect(classifyPdtpExecutionEvidence({ ...base, origin: "integration", sourceId: "run-1", evidenceText: "Inspección completada: run-1" })).toBe("source_record")
  })

  it("sin nada, no hay evidencia", () => {
    expect(classifyPdtpExecutionEvidence(base)).toBe("none")
  })
})
