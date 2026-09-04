/**
 * lib/__tests__/re08-master-list-mapping.test.ts
 *
 * El RE-08 embebido y su mapeo al catálogo documental.
 *
 * El listado vive como constante en el código porque `docs/` no viaja al
 * contenedor. El precio de embeberlo es que puede quedar viejo en silencio
 * cuando el SGI publique una versión nueva; el `sha256` es lo que convierte ese
 * silencio en una falla ruidosa.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  RE08_DOCUMENTS,
  RE08_SOURCE,
} from "@/lib/services/prevention-documents/master-list-2026"
import {
  deriveCategorySlug,
  deriveDocumentTypeCode,
} from "@/lib/services/prevention-documents/master-list-seed"
import {
  DEFAULT_CATEGORIES,
  DEFAULT_DOCUMENT_TYPES,
} from "@/lib/services/prevention-documents/taxonomy"

const sourcePath = path.resolve(process.cwd(), RE08_SOURCE.repoPath)

describe("RE08_DOCUMENTS", () => {
  it("trae los 99 documentos reales del listado", () => {
    expect(RE08_DOCUMENTS).toHaveLength(RE08_SOURCE.documentCount)
    expect(RE08_SOURCE.vacantCodes).toEqual(["RE-09", "RE-10", "RE-11"])
  })

  it("el Nº de fila es la identidad, y es único", () => {
    // No el código: `internal_code` no sirve de clave (ver el caso siguiente).
    const ns = RE08_DOCUMENTS.map((d) => d.n)
    expect(new Set(ns).size).toBe(ns.length)
  })

  it("los códigos NO son únicos, y por eso no hay índice único sobre ellos", () => {
    // Es un error del propio RE-08, no de la transcripción: DO-20 y DO-37
    // nombran dos documentos distintos cada uno. Ponerle un índice único a
    // `internal_code` reventaría el despliegue.
    const codes = RE08_DOCUMENTS.map((d) => d.code).filter((c): c is string => c !== null)
    const repetidos = codes.filter((code, index) => codes.indexOf(code) !== index)
    expect([...new Set(repetidos)].sort()).toEqual(["DO-20", "DO-37"])
  })

  it("las filas sin código quedan en null, no en un string vacío", () => {
    const sinCodigo = RE08_DOCUMENTS.filter((d) => d.code === null)
    expect(sinCodigo.length).toBeGreaterThan(0)
    expect(sinCodigo.every((d) => d.name.length > 0)).toBe(true)
  })

  it("las fechas de vigencia quedan en ISO, no en serial de Excel", () => {
    for (const doc of RE08_DOCUMENTS) {
      if (doc.effectiveFrom === null) continue
      expect(doc.effectiveFrom, `${doc.code ?? doc.name}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe("mapeo al catálogo documental", () => {
  const typeCodes = new Set(DEFAULT_DOCUMENT_TYPES.map((t) => t.code))
  const categorySlugs = new Set(DEFAULT_CATEGORIES.map((c) => c.slug))

  it("todo tipo derivado existe en el catálogo de tipos", () => {
    for (const doc of RE08_DOCUMENTS) {
      expect(typeCodes, `${doc.code ?? doc.name}`).toContain(deriveDocumentTypeCode(doc))
    }
  })

  it("toda categoría derivada existe en el catálogo de categorías", () => {
    for (const doc of RE08_DOCUMENTS) {
      expect(categorySlugs, `${doc.code ?? doc.name}`).toContain(deriveCategorySlug(doc))
    }
  })

  it("un RE- es formato aunque su nombre diga otra cosa", () => {
    // El formato en blanco es un documento; sus instancias viven en su módulo.
    expect(deriveDocumentTypeCode({ code: "RE-08", name: "Listado Maestro de Información Documentada" })).toBe("FORMATO")
    expect(deriveDocumentTypeCode({ code: "DO-06", name: "Identificación de Peligros" })).toBe("PROC")
    expect(deriveDocumentTypeCode({ code: null, name: "Política del Sistema Integrado" })).toBe("POL")
    expect(deriveDocumentTypeCode({ code: "DO-37", name: "Plan de Medio Ambiente" })).toBe("PROG")
  })

  it("los tipos nuevos no acreditan nada del PDTP", () => {
    // Tipar los dieciocho procedimientos operativos como PTS acreditaría
    // dieciocho unidades de la N°43, que se planifica por mes.
    for (const code of ["PROC", "INSTR", "POL", "PROG", "MATRIZ", "FORMATO"]) {
      const type = DEFAULT_DOCUMENT_TYPES.find((t) => t.code === code)
      expect(type, code).toBeDefined()
      expect(type!.pdtpActivityNumbers, code).toBeUndefined()
      expect(type!.pdtpAcknowledgmentActivityNumbers, code).toBeUndefined()
    }
  })
})

describe.skipIf(!existsSync(sourcePath))("el XLSX de origen", () => {
  it("no cambió de versión sin que se regenerara la constante", () => {
    // Si esto falla, corre `npx tsx scripts/extract-re08-master-list.ts` y
    // actualiza `master-list-2026.ts` junto con `RE08_SOURCE.sha256`.
    const actual = createHash("sha256").update(readFileSync(sourcePath)).digest("hex")
    expect(actual).toBe(RE08_SOURCE.sha256)
  })
})
