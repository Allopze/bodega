import { describe, expect, it } from "vitest"
import {
  EPP_APPROVER_ROLES,
  DISPATCH_DECIDER_ROLES,
  canApproveEpp,
  canSetDispatch,
} from "./roles"

describe("aprobaciones/roles — fuente única de verdad (H-1 / B-4)", () => {
  it("prevencionista SÍ puede aprobar EPP (regresión H-1)", () => {
    expect(canApproveEpp(["prevencionista"])).toBe(true)
  })

  it("jefatura/secretaría/admin pueden aprobar EPP", () => {
    expect(canApproveEpp(["administrador"])).toBe(true)
    expect(canApproveEpp(["jefa_chome"])).toBe(true)
    expect(canApproveEpp(["secretaria"])).toBe(true)
  })

  it("roles de faena no pueden aprobar EPP", () => {
    expect(canApproveEpp(["solicitante_faena"])).toBe(false)
    expect(canApproveEpp(["prevencionista_faena"])).toBe(false)
    expect(canApproveEpp([])).toBe(false)
  })

  it("el modo de despacho excluye a prevencionista (solo logística)", () => {
    expect(canSetDispatch(["prevencionista"])).toBe(false)
    expect(canSetDispatch(["secretaria"])).toBe(true)
    expect(canSetDispatch(["administrador"])).toBe(true)
    expect(canSetDispatch(["jefa_chome"])).toBe(true)
  })

  it("EPP approvers ⊇ dispatch deciders, divergiendo exactamente en prevencionista", () => {
    for (const r of DISPATCH_DECIDER_ROLES) expect(EPP_APPROVER_ROLES.has(r)).toBe(true)
    expect(EPP_APPROVER_ROLES.has("prevencionista")).toBe(true)
    expect(DISPATCH_DECIDER_ROLES.has("prevencionista")).toBe(false)
  })
})
