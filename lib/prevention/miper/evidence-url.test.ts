import { describe, expect, it } from "vitest"
import { MIPER_EVIDENCE_PATH_PREFIX, miperEvidenceHref } from "./evidence-url"

describe("miperEvidenceHref", () => {
  it("arma el enlace para abrir en el navegador", () => {
    expect(miperEvidenceHref(`${MIPER_EVIDENCE_PATH_PREFIX}acta.pdf`)).toBe("/api/prevencion/miper/evidence/acta.pdf")
  })

  it("con download agrega ?descargar=1", () => {
    expect(miperEvidenceHref(`${MIPER_EVIDENCE_PATH_PREFIX}acta.pdf`, { download: true })).toBe("/api/prevencion/miper/evidence/acta.pdf?descargar=1")
  })

  it("devuelve null para una ruta de otra carpeta", () => {
    expect(miperEvidenceHref("storage/hygiene-evidence/acta.pdf")).toBeNull()
    expect(miperEvidenceHref(MIPER_EVIDENCE_PATH_PREFIX)).toBeNull()
  })

  it("codifica un nombre con espacios", () => {
    expect(miperEvidenceHref(`${MIPER_EVIDENCE_PATH_PREFIX}acta de inspección.pdf`))
      .toBe("/api/prevencion/miper/evidence/acta%20de%20inspecci%C3%B3n.pdf")
  })
})
