import { describe, expect, it } from "vitest"
import {
  expiredDocumentTypes,
  expiringDocuments,
  resolveNextExpiryDate,
} from "@/lib/validation/fleet-documents"

/**
 * `expiringDocuments` es lo que el aviso diario recorre y lo que la ficha usa
 * para decir «según documento subido». Tiene que dar la misma respuesta que
 * `resolveNextExpiryDate` (lista y Panel operacional) y `expiredDocumentTypes`:
 * la columna del equipo manda y el documento vigente sólo aporta cuando esa
 * columna está vacía.
 */

describe("expiringDocuments", () => {
  it("las columnas declaradas del equipo salen con su rótulo y origen «vehicle»", () => {
    expect(expiringDocuments({
      soapExpiresAt: "2026-10-01",
      technicalReviewExpiresAt: "2026-09-20",
      circulationPermitExpiresAt: "2027-03-31",
      insuranceExpiresAt: "2026-11-15",
    }, [])).toEqual([
      { documentType: "Revisión técnica", expiresAt: "2026-09-20", source: "vehicle" },
      { documentType: "SOAP", expiresAt: "2026-10-01", source: "vehicle" },
      { documentType: "Seguro", expiresAt: "2026-11-15", source: "vehicle" },
      { documentType: "Permiso de circulación", expiresAt: "2027-03-31", source: "vehicle" },
    ])
  })

  it("una columna vacía o nula no aporta nada", () => {
    expect(expiringDocuments({ soapExpiresAt: null, insuranceExpiresAt: "" }, [])).toEqual([])
    expect(expiringDocuments({}, [])).toEqual([])
  })

  describe("precedencia: columna del equipo > documento vigente", () => {
    it("la columna manda aunque el documento del mismo tipo venza antes", () => {
      expect(expiringDocuments(
        { soapExpiresAt: "2027-06-01" },
        [{ documentType: "SOAP", expiresAt: "2026-01-01" }],
      )).toEqual([{ documentType: "SOAP", expiresAt: "2027-06-01", source: "vehicle" }])
    })

    it("el documento aporta su fecha cuando la columna de su tipo está vacía, con origen «document»", () => {
      expect(expiringDocuments(
        { soapExpiresAt: "2027-01-01" },
        [{ documentType: "Seguro", expiresAt: "2026-09-30" }],
      )).toEqual([
        { documentType: "Seguro", expiresAt: "2026-09-30", source: "document" },
        { documentType: "SOAP", expiresAt: "2027-01-01", source: "vehicle" },
      ])
    })

    it("una columna de otro tipo no tapa al documento", () => {
      const result = expiringDocuments(
        { technicalReviewExpiresAt: "2027-01-01" },
        [{ documentType: "SOAP", expiresAt: "2026-08-01" }],
      )
      expect(result.map((entry) => `${entry.documentType}:${entry.source}`)).toEqual(["SOAP:document", "Revisión técnica:vehicle"])
    })
  })

  describe("tipos sin columna propia", () => {
    it("Padrón, Certificado de emisiones y Otro aportan su documento vigente tal cual", () => {
      expect(expiringDocuments({}, [
        { documentType: "Padrón", expiresAt: "2026-12-01" },
        { documentType: "Certificado de emisiones", expiresAt: "2026-10-10" },
        { documentType: "Otro", expiresAt: "2027-02-02" },
      ])).toEqual([
        { documentType: "Certificado de emisiones", expiresAt: "2026-10-10", source: "document" },
        { documentType: "Padrón", expiresAt: "2026-12-01", source: "document" },
        { documentType: "Otro", expiresAt: "2027-02-02", source: "document" },
      ])
    })

    it("un documento sin fecha no cuenta", () => {
      expect(expiringDocuments({}, [{ documentType: "Padrón", expiresAt: null }])).toEqual([])
    })

    it("un tipo guardado con un slug viejo no se mezcla con el canónico: sale con su propio nombre", () => {
      expect(expiringDocuments(
        { technicalReviewExpiresAt: "2027-01-01" },
        [{ documentType: "revision_tecnica", expiresAt: "2026-09-01" }],
      ).map((entry) => entry.documentType)).toEqual(["revision_tecnica", "Revisión técnica"])
    })

    it("dos documentos vigentes del mismo tipo (no debería pasar): manda el que vence antes", () => {
      expect(expiringDocuments({}, [
        { documentType: "Padrón", expiresAt: "2027-05-05" },
        { documentType: "Padrón", expiresAt: "2026-11-11" },
      ])).toEqual([{ documentType: "Padrón", expiresAt: "2026-11-11", source: "document" }])
    })
  })

  describe("horizonte", () => {
    const declared = {
      soapExpiresAt: "2026-09-01",
      technicalReviewExpiresAt: "2026-10-14",
      circulationPermitExpiresAt: "2026-10-15",
    }

    it("incluye lo que vence hasta la fecha del horizonte, inclusive, y deja fuera lo posterior", () => {
      expect(expiringDocuments(declared, [], "2026-10-14").map((entry) => entry.documentType))
        .toEqual(["SOAP", "Revisión técnica"])
    })

    it("lo ya vencido entra (el horizonte es un techo, no una ventana)", () => {
      expect(expiringDocuments({ soapExpiresAt: "2020-01-01" }, [], "2026-10-14")).toHaveLength(1)
    })

    it("sin horizonte devuelve todo", () => {
      expect(expiringDocuments(declared, [])).toHaveLength(3)
    })

    it("también filtra lo que viene de documentos", () => {
      expect(expiringDocuments({}, [
        { documentType: "Padrón", expiresAt: "2026-10-01" },
        { documentType: "Otro", expiresAt: "2026-12-01" },
      ], "2026-10-14").map((entry) => entry.documentType)).toEqual(["Padrón"])
    })

    it("un horizonte anterior a todo devuelve vacío", () => {
      expect(expiringDocuments(declared, [], "2026-01-01")).toEqual([])
    })
  })

  it("ordena por fecha y desempata por nombre del tipo", () => {
    const result = expiringDocuments({ soapExpiresAt: "2026-10-01" }, [{ documentType: "Otro", expiresAt: "2026-10-01" }])
    expect(result.map((entry) => entry.documentType)).toEqual(["Otro", "SOAP"])
  })
})

describe("coincide con los otros criterios de vencimiento del equipo", () => {
  const fixtures: Array<{
    name: string
    declared: Parameters<typeof expiringDocuments>[0]
    documents: Parameters<typeof expiringDocuments>[1]
  }> = [
    { name: "sólo columnas", declared: { soapExpiresAt: "2026-09-01", technicalReviewExpiresAt: "2026-12-01" }, documents: [] },
    { name: "sólo documentos", declared: {}, documents: [{ documentType: "Seguro", expiresAt: "2026-08-01" }, { documentType: "Padrón", expiresAt: "2026-07-01" }] },
    {
      name: "mezcla con columna que tapa a su documento",
      declared: { soapExpiresAt: "2027-06-01" },
      documents: [{ documentType: "SOAP", expiresAt: "2026-01-01" }, { documentType: "Seguro", expiresAt: "2026-10-01" }],
    },
    { name: "sin nada", declared: {}, documents: [] },
  ]

  it.each(fixtures)("próximo vencimiento: $name", ({ declared, documents }) => {
    const first = expiringDocuments(declared, documents)[0]?.expiresAt ?? null
    expect(first).toBe(resolveNextExpiryDate(declared, documents))
  })

  it.each(fixtures)("tipos vencidos: $name", ({ declared, documents }) => {
    const today = "2026-09-14"
    const overdue = expiringDocuments(declared, documents)
      .filter((entry) => entry.expiresAt < today)
      .map((entry) => entry.documentType)
      .sort((a, b) => a.localeCompare(b))
    expect(overdue).toEqual(expiredDocumentTypes(declared, documents, today))
  })
})
