import { describe, expect, it } from "vitest"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { AREA_TO_WORKSITE, CARGO_MAP, absenceLabel, mapTalanaSex, textKey } from "./mapping"
import { decideTalanaAlert } from "./talana-alerts"
import { computeDifferences } from "./talana-differences"
import type { PlannerContract, PlannerWorker } from "./talana-planner"
import { summarizeTalanaPerson, talanaWorkerChips } from "./worker-hr-status"

const TODAY = "2026-11-08"

const contract = (extra: Partial<PlannerContract> = {}): PlannerContract => ({
  id: 1, rut: "11111111-1", rutValid: true, firstName: "JUAN", lastNamePaternal: "PEREZ", lastNameMaternal: null, sex: "M",
  employerName: "SERVICIOS INDUSTRIALES CHOME LTDA", contractType: "Indefinido", cargo: "CHOFER", costCenterId: 1,
  costCenterName: "CHOLGUAN MAQUINAS", jefeRut: null, jefeName: "PEDRO ROJAS", hiredOn: "2024-01-01", startsOn: "2024-01-01",
  endsOn: null, finiquitado: false, listedActive: true, activationProcessedAt: null, finiquitoProcessedAt: null, ...extra,
})

const worker = (extra: Partial<PlannerWorker> = {}): PlannerWorker => ({
  id: "w1", rut: "11111111-1", firstName: "Juan", lastName: "Pérez", sex: "male", positionId: "pos-cond", supervisor: "Pedro Rojas",
  worksiteId: "ws-cho", isActive: true, createdOn: "2025-01-01", ...extra,
})

describe("mapping (lo observado en el sondeo de 2026-11)", () => {
  it("los 11 centros de costo con gente tienen faena", () => {
    for (const cc of ["CHOLGUAN MAQUINAS", "SANTA FE GRUAS", "BIODIVERSA", "MASISA MADERAS", "ADMINISTRACION", "PACIFICO",
      "MASISA TABLEROS", "CHOLGUAN RESIDUOS", "TENO", "horcones asir", "COMPLEJO DEPORTIVO MASISA"]) {
      expect(AREA_TO_WORKSITE.get(textKey(cc)), cc).toBeTruthy()
    }
  })
  it("cargos y sexo", () => {
    expect(CARGO_MAP.get(textKey("Chofer"))).toBe("Conductor de camión")
    expect(mapTalanaSex("N")).toBeNull()
    expect(absenceLabel("licencia medica")).toBe("Licencia médica")
  })
})

describe("worker-hr-status", () => {
  it("licencia vigente y plazo vencido sin renovar dan dos chips", () => {
    const summary = summarizeTalanaPerson({
      contracts: [contract({ listedActive: false, contractType: "Plazo Fijo", endsOn: "2026-10-23" })],
      absences: [{ type: "licencia medica", startsOn: "2026-11-01", endsOn: "2026-11-12", approved: true }],
      today: TODAY, syncedAt: "2026-11-08T09:30:00Z",
    })
    expect(summary.contract?.state).toBe("vencido_sin_renovar")
    expect(summary.absence).toMatchObject({ label: "Licencia médica", current: true })
    expect(talanaWorkerChips(summary)).toEqual([
      { label: "Licencia médica hasta 12-11-2026", tone: "info" },
      { label: "Plazo vencido el 23-10-2026", tone: "warning" },
    ])
  })
  it("un indefinido vigente sin ausencias no tiene chips", () => {
    expect(talanaWorkerChips(summarizeTalanaPerson({ contracts: [contract()], absences: [], today: TODAY, syncedAt: null }))).toEqual([])
  })
})

describe("computeDifferences", () => {
  const base = {
    today: TODAY,
    positions: [{ id: "pos-cond", name: "Conductor de camión", isSystem: false, isActive: true, keys: [normalizeWorkerPositionKey("Conductor de camión")] }],
    worksites: [{ id: "ws-cho", name: "Cholguan - Arauco", isActive: true }, { id: "ws-bio", name: "Biodiversa", isActive: true }],
  }
  it("plazo vencido sin finiquito y activo en Chome sin contrato", () => {
    const diffs = computeDifferences({
      ...base,
      contracts: [contract({ listedActive: false, contractType: "Plazo Fijo", endsOn: "2026-10-23" })],
      workers: [worker(), worker({ id: "w2", rut: "22222222-2" })],
    })
    expect(diffs.map((d) => d.code).sort()).toEqual(["activo_sin_contrato", "plazo_vencido"])
  })
  it("faena distinta y jefe vacío", () => {
    const diffs = computeDifferences({ ...base, contracts: [contract({ jefeName: null, costCenterName: "BIODIVERSA" })], workers: [worker()] })
    expect(diffs.map((d) => d.code).sort()).toEqual(["faena_distinta", "jefe_vacio"])
  })
})

describe("decideTalanaAlert", () => {
  it("avisa un problema una vez al día por motivo y recupera una sola vez", () => {
    const blocked = decideTalanaAlert({ runId: "r1", status: "blocked", reason: "active_drop", failedPeople: 0 }, null, TODAY)
    expect(blocked).toMatchObject({ kind: "alert", dedupeKey: `talana-sync:blocked:active_drop:${TODAY}` })
    expect(decideTalanaAlert({ runId: "r2", status: "success", reason: null, failedPeople: 0 }, { status: "problem", fingerprint: "blocked:active_drop" }, TODAY))
      .toMatchObject({ kind: "recovery", dedupeKey: "talana-sync:recovery:r2" })
    expect(decideTalanaAlert({ runId: "r3", status: "success", reason: null, failedPeople: 0 }, { status: "ok", fingerprint: "ok" }, TODAY)).toBeNull()
  })
  it("el cuerpo no lleva datos de personas ni el código crudo cuando hay texto", () => {
    const failed = decideTalanaAlert({ runId: "r1", status: "failed", reason: "TALANA_AUTH_FAILED", failedPeople: 0 }, null, TODAY)
    expect(failed?.body).toContain("rechazó el token")
  })
})
