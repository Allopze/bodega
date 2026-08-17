import { describe, expect, it, vi } from "vitest"

const mockTransaction = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ db: { transaction: mockTransaction } }))

import { assertCapaTransition, createCapaAction } from "@/lib/services/prevention-capa"

const base = {
  priority: "medium",
  evidenceRequired: true,
  evidenceCount: 1,
  creatorUserId: "creator-1",
  actorUserId: "verifier-1",
  permissions: [
    "prevention:capa:manage",
    "prevention:capa:complete",
    "prevention:capa:verify",
    "prevention:capa:close",
  ],
} as const

describe("CAPA state machine", () => {
  it("blocks direct closure and completion without required evidence", () => {
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "pending",
      toStatus: "closed",
    })).toThrow(/transición.*inválida/i)
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "in_progress",
      toStatus: "pending_verification",
      evidenceCount: 0,
    })).toThrow(/exige evidencia/i)
  })

  it("requires effectiveness evidence and segregation for high actions", () => {
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "pending_verification",
      toStatus: "verified",
      priority: "high",
      actorUserId: "creator-1",
      effectivenessStatus: "effective",
      effectivenessAssessment: "El control fue observado en terreno.",
    })).toThrow(/persona distinta/i)
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "pending_verification",
      toStatus: "verified",
      priority: "high",
      actorUserId: "creator-1",
      permissions: [...base.permissions, "prevention:capa:override_segregation"],
      segregationExceptionReason: "Contingencia documentada sin otro verificador disponible",
      effectivenessStatus: "effective",
      effectivenessAssessment: "El control fue observado en terreno.",
    })).not.toThrow()
  })

  /**
   * El PPA conduce su propia CAPA y su segregación es por PERMISO, no por
   * persona (decisión registrada): en terreno, quien declara la corrección es
   * quien la verifica. Exigir dos identidades ahí dejaba el caso detenido sin
   * salida — lo destapó el e2e (`ppa-flow.spec.ts`), no las pruebas unitarias,
   * porque éstas usaban usuarios distintos.
   *
   * Es seguro por exclusividad: `assertNotPpaDriven` impide que el motor
   * genérico de CAPA toque una acción de origen `ppa`, así que el único
   * conductor es el PPA. Si alguien retira ese guard, esta excepción deja de
   * serlo y hay que revisar las dos cosas juntas.
   */
  it("no aplica la segregación por identidad a una acción conducida por el PPA", () => {
    const ppaVerification = {
      ...base,
      fromStatus: "pending_verification" as const,
      toStatus: "verified" as const,
      priority: "high" as const,
      actorUserId: "creator-1",
      completedByUserId: "creator-1",
      effectivenessStatus: "effective" as const,
      effectivenessAssessment: "Cable retirado y zona despejada, verificado en terreno.",
    }
    expect(() => assertCapaTransition({ ...ppaVerification, sourceType: "ppa" })).not.toThrow()
    // Control: el mismo caso en cualquier otro origen sí se rechaza.
    expect(() => assertCapaTransition({ ...ppaVerification, sourceType: "inspection" }))
      .toThrow(/persona distinta/i)
  })

  it("blocks verification by the responsible or the completer, at any priority", () => {
    for (const key of ["responsibleUserId", "completedByUserId"] as const) {
      expect(() => assertCapaTransition({
        ...base, fromStatus: "pending_verification", toStatus: "verified",
        priority: "low", [key]: "verifier-1",
        effectivenessStatus: "effective",
        effectivenessAssessment: "El control fue observado en terreno.",
      })).toThrow(/persona distinta/i)
    }
  })

  it("requires a reason to reopen or cancel and the target-specific permission", () => {
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "pending_verification",
      toStatus: "reopened",
    })).toThrow(/motivo/i)
    expect(() => assertCapaTransition({
      ...base,
      fromStatus: "pending",
      toStatus: "cancelled",
      reason: "La actividad fuente fue cancelada formalmente.",
      permissions: ["prevention:capa:view"],
    })).toThrow(/no encontrada o fuera de alcance/i)
  })

  it("fails before DB writes for missing permission or a foreign worksite", async () => {
    const input = {
      sourceType: "manual",
      sourceId: "manual-1",
      worksiteId: "ws-foreign",
      finding: "Hallazgo de prueba",
      actionDescription: "Implementar control",
      targetDate: "2026-08-31",
    }
    await expect(createCapaAction({
      input,
      ctx: { userId: "user-1" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:capa:view"],
    })).rejects.toThrow(/no encontrada o fuera de alcance/i)
    await expect(createCapaAction({
      input,
      ctx: { userId: "user-1" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:capa:manage"],
    })).rejects.toThrow(/no encontrada o fuera de alcance/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
