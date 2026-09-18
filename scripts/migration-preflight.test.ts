import { describe, expect, it } from "vitest"
import {
  assertAllMigrationsApplied,
  assertMigrationPreflightReport,
  type MigrationPreflightReport,
} from "./migration-preflight.mjs"

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
    legal: { duplicateApplicabilities: 0 },
    inspections: { duplicateProgramSlots: 0 },
    campaigns: { completedWithoutEvidence: 0 },
    migrations: { appliedCount: 0, journalCount: 0, skipped: [], missing: [] },
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

  // B-04: sin idempotencia por slot, dos disparos del cron el mismo día
  // duplicarían la ejecución del período.
  it("bloquea ejecuciones duplicadas del mismo slot de programación", () => {
    const report = cleanReport()
    report.inspections = { duplicateProgramSlots: 2 }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/INSPECTIONS.*2/)
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

  // LEGAL-04: el índice único parcial de aplicabilidad con proceso nulo no se
  // puede crear sobre una base que ya trae dos pronunciamientos para el mismo
  // requisito y faena, y una migración que falla a medias rompe el despliegue.
  it("bloquea aplicabilidades legales duplicadas antes de crear el índice único", () => {
    const report = cleanReport()
    report.legal = { duplicateApplicabilities: 3 }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/LEGAL.*3/)
  })

  /* La simplificación de Campañas (2026-09-14) estrena un CHECK que exige
   * evidencia en toda campaña hecha. Las cerradas cuando la evidencia era
   * opcional harían fallar la migración con una violación de constraint a
   * mitad del deploy: se bloquea antes, con el detalle de cómo reconciliarlas. */
  it("bloquea campañas cerradas sin la evidencia que el modelo nuevo exige", () => {
    const report = cleanReport()
    report.campaigns = { completedWithoutEvidence: 4 }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/CAMPAIGNS.*4/)
    expect(() => assertMigrationPreflightReport(report)).toThrow(/antes de migrar/)
  })

  it("acepta una base nueva o una base sin conflictos", () => {
    const report = cleanReport()
    report.skippedRelations.push("dte_documents")

    expect(assertMigrationPreflightReport(report)).toBe(report)
  })
})

/* El migrador de Drizzle usa una sola marca de agua (`MAX(created_at)`) y un
 * `<` estricto: una migración que entra al repositorio con un `when` anterior
 * al de otra ya aplicada queda saltada para siempre, sin error. Pasó con la
 * 0236 —la que separa las integraciones del índice de período de
 * `pdtp_executions`— y el síntoma apareció meses después. */
describe("migraciones saltadas", () => {
  it("bloquea cuando la base pasó de largo una migración del artefacto", () => {
    const report = cleanReport()
    report.migrations = {
      appliedCount: 255,
      journalCount: 256,
      skipped: ["0236_typical_abomination"],
      missing: ["0236_typical_abomination"],
    }

    expect(() => assertMigrationPreflightReport(report)).toThrow(/0236_typical_abomination/)
    expect(() => assertMigrationPreflightReport(report)).toThrow(/no las reintenta/)
  })

  it("no bloquea por las migraciones que todavía faltan por aplicar", () => {
    // `skipped` sólo trae las anteriores a la última aplicada; las pendientes
    // al final de la lista son el estado normal antes de migrar.
    const report = cleanReport()
    report.migrations = {
      appliedCount: 250,
      journalCount: 256,
      skipped: [],
      missing: ["0253_a", "0254_b", "0255_c", "0256_d", "0257_e", "0258_f"],
    }

    expect(() => assertMigrationPreflightReport(report)).not.toThrow()
  })
})

/* La contraparte del preflight, que corre DESPUÉS de migrar. El preflight no
 * puede cubrir este caso: cuando él corre, una migración ausente todavía es
 * indistinguible de una pendiente legítima. En producción las 0297-0300
 * quedaron fuera, `migrate` salió con éxito y el deploy reventó cien líneas más
 * abajo en un script de datos, contra `catalog_activity_id`. */
describe("verificación posterior a migrar", () => {
  it("falla si quedó cualquier migración sin aplicar", () => {
    expect(() =>
      assertAllMigrationsApplied({
        appliedCount: 303,
        journalCount: 307,
        missing: ["0297_panoramic_meltdown", "0298_nasty_bastion", "0299_cold_devos", "0300_nifty_namorita"],
      }),
    ).toThrow(/MIGRATIONS_INCOMPLETAS/)
  })

  it("nombra las que faltan y el recuento, para no obligar a diagnosticar a mano", () => {
    const incomplete = () =>
      assertAllMigrationsApplied({
        appliedCount: 303,
        journalCount: 307,
        missing: ["0297_panoramic_meltdown", "0300_nifty_namorita"],
      })

    expect(incomplete).toThrow(/303 de 307/)
    expect(incomplete).toThrow(/0297_panoramic_meltdown, 0300_nifty_namorita/)
  })

  /* Distinto del preflight: acá una pendiente al final NO es tolerable. Si
   * `migrate()` terminó y algo sigue sin aplicarse, el migrador ya decidió que
   * no lo va a reintentar. */
  it("no tolera pendientes al final, a diferencia del preflight", () => {
    expect(() =>
      assertAllMigrationsApplied({ appliedCount: 306, journalCount: 307, missing: ["0307_ultima"] }),
    ).toThrow(/0307_ultima/)
  })

  it("pasa cuando la base y el journal coinciden", () => {
    expect(() =>
      assertAllMigrationsApplied({ appliedCount: 307, journalCount: 307, missing: [] }),
    ).not.toThrow()
  })
})
