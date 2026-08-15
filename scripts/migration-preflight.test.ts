import { describe, expect, it } from "vitest"
import { assertMigrationPreflightReport, type MigrationPreflightReport } from "./migration-preflight.mjs"

function cleanReport(): MigrationPreflightReport {
  return {
    legacyActionRows: {
      pdtp_action_plan: 0,
      pdtp_action_plan_followups: 0,
      sst_action_plan: 0,
      ppa_corrective_actions: 0,
    },
    dte: { dualBusinessLinks: 0, duplicatePurchaseInvoices: 0 },
    pdtp: { legacyObjectiveLinks: 0, duplicateYears: 0 },
    skippedRelations: [],
  }
}

describe("migration preflight", () => {
  it.each([
    "pdtp_action_plan",
    "pdtp_action_plan_followups",
    "sst_action_plan",
    "ppa_corrective_actions",
  ] as const)("bloquea el retiro de %s cuando conserva historia", (table) => {
    const report = cleanReport()
    report.legacyActionRows[table] = 1

    expect(() => assertMigrationPreflightReport(report)).toThrow(
      new RegExp(`${table}.*1`),
    )
  })

  it("bloquea vínculos DTE incompatibles y duplicados", () => {
    const report = cleanReport()
    report.dte = { dualBusinessLinks: 2, duplicatePurchaseInvoices: 1 }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/DTE.*2.*1/)
  })

  it("bloquea una migración anual PDTP que no fue reconciliada", () => {
    const report = cleanReport()
    report.pdtp = { legacyObjectiveLinks: 1, duplicateYears: 2 }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/PDTP.*1.*2/)
  })

  it("acepta una base nueva o una base sin conflictos", () => {
    const report = cleanReport()
    report.skippedRelations.push("dte_documents")

    expect(assertMigrationPreflightReport(report)).toBe(report)
  })
})
