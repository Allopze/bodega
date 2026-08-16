import { describe, expect, it } from "vitest"
import {
  countUnassessedProtocols,
  MINSAL_PROTOCOLS,
  summarizeProtocolCoverage,
} from "./minsal-protocols"

const TODAY = "2026-08-15"

describe("summarizeProtocolCoverage", () => {
  it("trata el protocolo sin fila como 'por evaluar', no como 'no aplica'", () => {
    const coverage = summarizeProtocolCoverage([], TODAY)

    expect(coverage).toHaveLength(MINSAL_PROTOCOLS.length)
    expect(coverage.every((item) => item.status === "pending_assessment")).toBe(true)
    expect(countUnassessedProtocols(coverage)).toBe(MINSAL_PROTOCOLS.length)
  })

  it("marca vencido sólo el protocolo aplicable con fecha pasada", () => {
    const coverage = summarizeProtocolCoverage([
      { protocolCode: "prexor", status: "applicable", nextAssessmentOn: "2026-01-01" },
      { protocolCode: "silice", status: "applicable", nextAssessmentOn: "2027-01-01" },
    ], TODAY)

    expect(coverage.find((item) => item.code === "prexor")?.overdue).toBe(true)
    expect(coverage.find((item) => item.code === "silice")?.overdue).toBe(false)
  })

  it("no pone reloj a un protocolo descartado con justificación", () => {
    const coverage = summarizeProtocolCoverage([
      { protocolCode: "hiperbaria", status: "not_applicable", nextAssessmentOn: "2020-01-01" },
    ], TODAY)

    const row = coverage.find((item) => item.code === "hiperbaria")
    expect(row?.status).toBe("not_applicable")
    expect(row?.overdue).toBe(false)
  })

  it("un aplicable sin fecha no está vencido", () => {
    const coverage = summarizeProtocolCoverage([
      { protocolCode: "uv", status: "applicable", nextAssessmentOn: null },
    ], TODAY)

    expect(coverage.find((item) => item.code === "uv")?.overdue).toBe(false)
  })

  it("descuenta del pendiente sólo lo que tiene pronunciamiento", () => {
    const coverage = summarizeProtocolCoverage([
      { protocolCode: "prexor", status: "applicable", nextAssessmentOn: "2027-01-01" },
      { protocolCode: "hiperbaria", status: "not_applicable", nextAssessmentOn: null },
    ], TODAY)

    expect(countUnassessedProtocols(coverage)).toBe(MINSAL_PROTOCOLS.length - 2)
  })
})

describe("catálogo MINSAL", () => {
  it("no tiene códigos repetidos", () => {
    const codes = MINSAL_PROTOCOLS.map((protocol) => protocol.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("declara base legal y periodicidad para cada protocolo", () => {
    for (const protocol of MINSAL_PROTOCOLS) {
      expect(protocol.legalBasis.length).toBeGreaterThan(5)
      expect(protocol.defaultPeriodicityMonths).toBeGreaterThan(0)
    }
  })
})
