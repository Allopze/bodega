/**
 * Patrón P4 (auditoría 2026-09-14): la evidencia era una cadena de texto en
 * todos los módulos menos uno. `CAPA-001` es el caso que más pesa —escribir
 * `kind: "photo"`, `reference: "foto tomada en terreno"` habilitaba verificar y
 * cerrar la acción que otros módulos usan como prueba—.
 */
import { describe, expect, it } from "vitest"
import {
  checkEvidence,
  classifyEvidence,
  describeEvidenceProblems,
  EVIDENCE_STORAGE_PREFIXES,
} from "./evidence-contract"

const SHA = "a".repeat(64)
const RUTA_PDTP = `${EVIDENCE_STORAGE_PREFIXES.pdtp}/acta-2026-09.pdf`
const RUTA_INSPECCION = `${EVIDENCE_STORAGE_PREFIXES.inspection}/foto-01.jpg`
const RUTA_TRAINING = `${EVIDENCE_STORAGE_PREFIXES.training}/acta-cap-02.pdf`

describe("los prefijos son los que la plataforma tiene de verdad", () => {
  it("sólo usa directorios de evidencia registrados por dominio", () => {
    // `campaign` y `cgrd` entran con la simplificación de 2026-09-14: su
    // evidencia pasó a ser obligatoria y estrenaron dónde subir el archivo.
    expect(Object.keys(EVIDENCE_STORAGE_PREFIXES).sort())
      .toEqual(["campaign", "cgrd", "inspection", "pdtp", "training"])
  })

  it("cada dominio apunta a su propio directorio, sin solaparse", () => {
    const prefijos = Object.values(EVIDENCE_STORAGE_PREFIXES)
    expect(new Set(prefijos).size).toBe(prefijos.length)
  })
})

describe("document y photo: lo que dice ser un archivo tiene que serlo", () => {
  it("acepta una ruta de cualquier directorio de evidencia, con checksum", () => {
    expect(checkEvidence({ kind: "document", reference: RUTA_PDTP, checksumSha256: SHA })).toEqual([])
    expect(checkEvidence({ kind: "photo", reference: RUTA_INSPECCION, checksumSha256: SHA })).toEqual([])
    expect(checkEvidence({ kind: "document", reference: RUTA_TRAINING, checksumSha256: SHA })).toEqual([])
  })

  it("rechaza el texto libre que antes bastaba", () => {
    const problemas = checkEvidence({ kind: "photo", reference: "foto tomada en terreno", checksumSha256: null })
    expect(problemas.map((p) => p.field)).toEqual(["reference", "checksumSha256"])
    expect(describeEvidenceProblems(problemas)).toContain("storage/")
  })

  it("exige el checksum aunque la ruta sea correcta", () => {
    const problemas = checkEvidence({ kind: "document", reference: RUTA_PDTP })
    expect(problemas).toHaveLength(1)
    expect(problemas[0]?.field).toBe("checksumSha256")
  })

  it("no acepta un checksum que no sea SHA-256", () => {
    for (const malo of ["", "abc", "A".repeat(64), "a".repeat(63)]) {
      const problemas = checkEvidence({ kind: "document", reference: RUTA_PDTP, checksumSha256: malo })
      expect(problemas.some((p) => p.field === "checksumSha256"), `checksum «${malo}»`).toBe(true)
    }
  })

  it("no deja salir del directorio de evidencia", () => {
    const fugas = [
      "storage/pdtp-evidence/../../etc/passwd",
      "storage/pdtp-evidence/sub/dir/acta.pdf",
      "storage/config/secreto.env",
      "/etc/passwd",
    ]
    for (const ruta of fugas) {
      const problemas = checkEvidence({ kind: "document", reference: ruta, checksumSha256: SHA })
      expect(problemas.some((p) => p.field === "reference"), `ruta «${ruta}»`).toBe(true)
    }
  })

  it("se puede acotar a un solo directorio cuando el llamador sabe cuál", () => {
    expect(checkEvidence({ kind: "document", reference: RUTA_PDTP, checksumSha256: SHA }, ["inspection"]))
      .not.toEqual([])
    expect(checkEvidence({ kind: "document", reference: RUTA_INSPECCION, checksumSha256: SHA }, ["inspection"]))
      .toEqual([])
  })
})

describe("url: que sea una URL, no cualquier texto", () => {
  it("acepta http y https", () => {
    expect(checkEvidence({ kind: "url", reference: "https://drive.chome.cl/acta" })).toEqual([])
    expect(checkEvidence({ kind: "url", reference: "http://intranet/acta" })).toEqual([])
  })

  it("rechaza texto suelto y esquemas que no son navegables", () => {
    for (const malo of ["ver en la carpeta compartida", "javascript:alert(1)", "file:///etc/passwd", ""]) {
      expect(checkEvidence({ kind: "url", reference: malo }), `url «${malo}»`).not.toEqual([])
    }
  })
})

describe("note: una anotación, y se dice como tal", () => {
  it("se admite libre: no sostiene una verificación y los gates ya la excluyen", () => {
    expect(checkEvidence({ kind: "note", reference: "Se coordinó con el supervisor" })).toEqual([])
  })

  it("pero tiene que decir algo", () => {
    expect(checkEvidence({ kind: "note", reference: "  " })).not.toEqual([])
  })
})

/**
 * Al aplicar el contrato salió a la luz que PDTP guardaba `evidenciaUrl` con
 * `kind: "document"` fuera cual fuera su contenido. Un enlace etiquetado como
 * documento es el mismo mal etiquetado que este patrón describe, del lado del
 * escritor en vez del formulario.
 */
describe("classifyEvidence — clasificar por contenido, no por el nombre del campo", () => {
  it("una ruta del storage es un archivo", () => {
    expect(classifyEvidence(RUTA_PDTP)).toBe("document")
    expect(classifyEvidence(RUTA_PDTP, "photo")).toBe("photo")
  })

  it("una URL es un enlace, aunque el campo se llame «documento»", () => {
    expect(classifyEvidence("https://drive.chome.cl/acta")).toBe("url")
  })

  it("y cualquier otra cosa es una anotación: se guarda, pero no sostiene la verificación", () => {
    expect(classifyEvidence("lo dejé en la carpeta compartida")).toBe("note")
    expect(classifyEvidence("")).toBe("note")
  })
})
