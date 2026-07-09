import { describe, expect, it } from "vitest"
import {
  decisionTypeLabel,
  roleContextLabel,
  summarizeRequestPeople,
} from "./request-people-panel.helpers"

describe("request people panel helpers", () => {
  it("summarizes requester and latest approver", () => {
    expect(
      summarizeRequestPeople({
        requesterName: "Ana Solis",
        requesterEmail: "ana@chome.cl",
        decisions: [
          {
            id: "dec-1",
            type: "approve",
            itemName: "CASCO",
            decidedByName: "Mario Jefe",
            decidedByEmail: "mario@chome.cl",
            roleContext: "jefa_chome",
            decidedAt: "2026-07-08T10:00:00.000Z",
            reason: null,
            modifiedQty: null,
          },
        ],
      }),
    ).toEqual({
      requester: "Ana Solis",
      latestDecisionBy: "Mario Jefe",
      latestDecisionLabel: "Aprobó",
    })
  })

  it("labels decision types and role contexts for users", () => {
    expect(decisionTypeLabel("approve")).toBe("Aprobó")
    expect(decisionTypeLabel("return")).toBe("Devolvió")
    expect(roleContextLabel("jefa_chome")).toBe("Jefatura")
    expect(roleContextLabel(null)).toBe("Rol no registrado")
  })
})
