import { describe, expect, it } from "vitest"
import {
  assertIncidentTransition,
  incidentNotificationDeadline,
  incidentRequiresCapa,
  requiredIncidentNotificationTypes,
} from "@/lib/services/prevention-incidents"

const incident = {
  status: "pending_verification",
  eventType: "work_accident",
  actualSeverity: "lost_time",
  potentialSeverity: "high",
  isFatalOrSerious: false,
  immediateMeasures: "Área aislada y atención inicial registrada",
}

describe("prevention incident legal workflow", () => {
  it("calculates the DIAT/DIEP deadline as exactly 24 elapsed hours from knowledge", () => {
    expect(incidentNotificationDeadline("2026-09-06T01:30:00-04:00")).toBe("2026-09-07T05:30:00.000Z")
  })

  it("creates separate legal lanes without pretending they are the principal state", () => {
    expect(requiredIncidentNotificationTypes({ eventType: "work_accident", isFatalOrSerious: false })).toEqual(["diat"])
    expect(requiredIncidentNotificationTypes({ eventType: "suspected_occupational_disease", isFatalOrSerious: false })).toEqual(["diep"])
    expect(requiredIncidentNotificationTypes({ eventType: "work_accident", isFatalOrSerious: true })).toEqual([
      "diat", "fatal_dt", "fatal_seremi", "restart_authorization",
    ])
  })

  it("blocks closure while a legal lane is overdue even if investigation and CAPA are done", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "overdue", evidenceReference: null }],
    })).toThrow(/pendientes\/atrasados/i)
  })

  it("requires notification evidence and closed CAPA before closing", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      capaStatuses: ["verified"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).toThrow(/CAPA deben estar cerradas/i)
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: null }],
    })).toThrow(/requieren evidencia/i)
  })

  it("allows closure only after all independent gates are satisfied", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).not.toThrow()
  })

  it("requires CAPA for high-potential and lost-time events", () => {
    expect(incidentRequiresCapa({ actualSeverity: "none", potentialSeverity: "high", isFatalOrSerious: false })).toBe(true)
    expect(incidentRequiresCapa({ actualSeverity: "lost_time", potentialSeverity: "low", isFatalOrSerious: false })).toBe(true)
    expect(incidentRequiresCapa({ actualSeverity: "minor", potentialSeverity: "low", isFatalOrSerious: false })).toBe(false)
  })
})
