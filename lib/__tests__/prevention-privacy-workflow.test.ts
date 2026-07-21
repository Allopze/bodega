import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import {
  assertPrivacyRequestTransition,
  getPreventionPrivacyExportDataset,
} from "@/lib/services/prevention-privacy"

describe("privacy request workflow", () => {
  it("requires identity validation before processing and a reason for terminal states", () => {
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "validando_identidad",
      toStatus: "en_proceso",
      rightType: "access",
      legalHold: false,
    })).not.toThrow()
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "recibida",
      toStatus: "completada",
      rightType: "access",
      legalHold: false,
      reason: "entregada",
    })).toThrow(/transición.*inválida/i)
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "en_proceso",
      toStatus: "completada",
      rightType: "access",
      legalHold: false,
    })).toThrow(/motivo/i)
  })

  it("prevents completion under legal hold and requires an explicit release", () => {
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "en_proceso",
      toStatus: "completada",
      rightType: "deletion",
      legalHold: true,
      reason: "retención vigente",
    })).toThrow(/retención legal/i)
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "suspendida_retencion",
      toStatus: "en_proceso",
      rightType: "access",
      legalHold: true,
      reason: "causal terminada",
    })).toThrow(/liberar expresamente/i)
    expect(() => assertPrivacyRequestTransition({
      fromStatus: "suspendida_retencion",
      toStatus: "en_proceso",
      rightType: "access",
      legalHold: true,
      reason: "causal terminada",
      releaseLegalHold: true,
    })).not.toThrow()
  })

  it("rejects subject exports before touching the database when permission is absent", async () => {
    await expect(getPreventionPrivacyExportDataset({
      requestId: "ppr-1",
      includeClinical: false,
      purpose: "derecho de acceso",
      ctx: { userId: "prev-general" },
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:docs:view"],
    })).rejects.toThrow(/no encontrada o fuera de alcance/i)
  })
})
