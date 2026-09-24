import { describe, expect, it } from "vitest"
import {
  CORPORATE_FOLDER,
  generatedDocumentRemoteKey,
  normalizeGeneratedArchiveBasePath,
  remoteFoldersOverlap,
  sanitizeRemoteFileName,
  sanitizeRemoteSegment,
  withCollisionSuffix,
} from "@/lib/services/generated-documents/remote-key"
import { hasExpectedSignature } from "@/lib/services/generated-documents/kinds"

describe("sanitizeRemoteSegment", () => {
  it("nunca deja un segmento de retroceso", () => {
    expect(sanitizeRemoteSegment("..")).toBe("sin-nombre")
    expect(sanitizeRemoteSegment(".")).toBe("sin-nombre")
    expect(sanitizeRemoteSegment("../../etc")).toBe("-..-etc")
    expect(sanitizeRemoteSegment("..Faena..")).toBe("Faena")
  })

  it("reemplaza lo que Windows no admite y los caracteres de control", () => {
    expect(sanitizeRemoteSegment('Faena "Norte": 1/2 \\ <x>|?*')).toBe("Faena -Norte-- 1-2 - -x----")
    expect(sanitizeRemoteSegment("Faena\u0000\u001fNorte")).toBe("Faena Norte")
  })

  it("normaliza a NFC y evita los nombres reservados de Windows", () => {
    expect(sanitizeRemoteSegment("María")).toBe("María")
    expect(sanitizeRemoteSegment("CON")).toBe("_CON")
    expect(sanitizeRemoteSegment("nul.txt")).toBe("_nul.txt")
  })

  it("acota el largo sin dejar un punto al final", () => {
    const long = sanitizeRemoteSegment(`${"a".repeat(119)}.b`)
    expect(Array.from(long).length).toBeLessThanOrEqual(120)
    expect(long.endsWith(".")).toBe(false)
  })

  it("un valor vacío toma el respaldo", () => {
    expect(sanitizeRemoteSegment(null, CORPORATE_FOLDER)).toBe("Corporativo")
    expect(sanitizeRemoteSegment("   ", CORPORATE_FOLDER)).toBe("Corporativo")
  })
})

describe("sanitizeRemoteFileName", () => {
  it("conserva la extensión y sanea el resto", () => {
    expect(sanitizeRemoteFileName("INS-2026-0004 - revisada", "pdf")).toBe("INS-2026-0004 - revisada.pdf")
    expect(sanitizeRemoteFileName("Evaluación Nuevo Ana/Pérez.PDF", "pdf")).toBe("Evaluación Nuevo Ana-Pérez.pdf")
  })

  it("rechaza una extensión que no es segura", () => {
    expect(() => sanitizeRemoteFileName("x", "p/df")).toThrow()
  })
})

describe("normalizeGeneratedArchiveBasePath", () => {
  it("usa el valor por defecto sin configuración", () => {
    expect(normalizeGeneratedArchiveBasePath(undefined)).toBe("Documentos generados")
  })

  it("quita barras de los bordes y valida cada tramo", () => {
    expect(normalizeGeneratedArchiveBasePath("/Prevención/Documentos/")).toBe("Prevención/Documentos")
    expect(() => normalizeGeneratedArchiveBasePath("Prevención/../otra")).toThrow()
    expect(() => normalizeGeneratedArchiveBasePath("Prev:ención")).toThrow()
  })

  it("no admite la raíz de la cuenta", () => {
    expect(() => normalizeGeneratedArchiveBasePath("/")).toThrow(/raíz/)
  })
})

describe("remoteFoldersOverlap", () => {
  it("detecta que una carpeta contiene a la otra, sin distinguir mayúsculas", () => {
    expect(remoteFoldersOverlap("storage/sst-documents", "storage/sst-documents/Generados")).toBe(true)
    expect(remoteFoldersOverlap("Storage/SST-documents", "storage/sst-documents")).toBe(true)
    expect(remoteFoldersOverlap("Documentos generados", "storage/sst-documents")).toBe(false)
    expect(remoteFoldersOverlap("storage/sst", "storage/sst-documents")).toBe(false)
  })

  it("la raíz se cruza con todo", () => {
    expect(remoteFoldersOverlap("Documentos generados", "")).toBe(true)
  })
})

describe("generatedDocumentRemoteKey", () => {
  const base = {
    basePath: "Documentos generados",
    year: 2026,
    worksiteLabel: "Faena Norte",
    moduleLabel: "Inspecciones",
    fileName: "INS-2026-0004 - revisada.pdf",
  }

  it("por faena", () => {
    expect(generatedDocumentRemoteKey({ ...base, layout: "faena" }))
      .toBe("Documentos generados/Faena Norte/INS-2026-0004 - revisada.pdf")
  })

  it("año › faena › módulo, en ese orden", () => {
    expect(generatedDocumentRemoteKey({ ...base, layout: "anio_faena_modulo" }))
      .toBe("Documentos generados/2026/Faena Norte/Inspecciones/INS-2026-0004 - revisada.pdf")
  })

  it("un documento sin faena va a Corporativo, y una faena llamada .. no sale de la base", () => {
    expect(generatedDocumentRemoteKey({ ...base, layout: "faena", worksiteLabel: null }))
      .toBe("Documentos generados/Corporativo/INS-2026-0004 - revisada.pdf")
    expect(generatedDocumentRemoteKey({ ...base, layout: "faena", worksiteLabel: ".." }))
      .toBe("Documentos generados/Corporativo/INS-2026-0004 - revisada.pdf")
  })

  it("rechaza un nombre de archivo sin sanear o un año imposible", () => {
    expect(() => generatedDocumentRemoteKey({ ...base, layout: "faena", fileName: "../x.pdf" })).toThrow()
    expect(() => generatedDocumentRemoteKey({ ...base, layout: "faena", year: 26 })).toThrow()
  })
})

describe("withCollisionSuffix", () => {
  it("agrega el número antes de la extensión", () => {
    expect(withCollisionSuffix("a/b/Doc.pdf", 1)).toBe("a/b/Doc.pdf")
    expect(withCollisionSuffix("a/b/Doc.pdf", 2)).toBe("a/b/Doc (2).pdf")
    expect(withCollisionSuffix("a/b/Doc v1.xlsx", 3)).toBe("a/b/Doc v1 (3).xlsx")
  })
})

describe("hasExpectedSignature", () => {
  it("reconoce un PDF y un .xlsx por sus bytes mágicos", () => {
    expect(hasExpectedSignature(Buffer.from("%PDF-1.7"), "pdf")).toBe(true)
    expect(hasExpectedSignature(Buffer.from("<html>"), "pdf")).toBe(false)
    expect(hasExpectedSignature(Buffer.from("PK\u0003\u0004"), "xlsx")).toBe(true)
    expect(hasExpectedSignature(Buffer.from("%PDF"), "xlsx")).toBe(false)
  })
})
