import { describe, expect, it } from "vitest"
import {
  assertIncidentTransition,
  incidentNotificationDeadline,
  incidentRequiresCapa,
  requiredIncidentNotificationTypes,
} from "@/lib/services/prevention-incidents"

const INVESTIGADOR = "u-investiga"
const CERRADOR = "u-cierra"

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
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: CERRADOR,
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
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: CERRADOR,
      capaStatuses: ["verified"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).toThrow(/CAPA deben estar cerradas/i)
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: CERRADOR,
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
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: CERRADOR,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).not.toThrow()
  })

  it("requires CAPA for high-potential and lost-time events", () => {
    expect(incidentRequiresCapa({ actualSeverity: "none", potentialSeverity: "high", isFatalOrSerious: false })).toBe(true)
    expect(incidentRequiresCapa({ actualSeverity: "lost_time", potentialSeverity: "low", isFatalOrSerious: false })).toBe(true)
    expect(incidentRequiresCapa({ actualSeverity: "minor", potentialSeverity: "low", isFatalOrSerious: false })).toBe(false)
  })

  /* Quinta compuerta, y la única sobre personas. Las otras cuatro miran el
   * estado del caso; un expediente cerrado tiene que poder demostrar además
   * quién lo firmó, y hasta ahora el mismo que investigó podía cerrarlo. */
  it("blocks closure by the same person who completed the investigation", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: INVESTIGADOR,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).toThrow(/no puede cerrar el incidente/i)
  })

  it("lets the technical head close an investigation they completed themselves", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close", "prevention:sign_own_work"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: INVESTIGADOR,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).not.toThrow()
  })

  /**
   * INC-002 (auditoría 2026-09-14) — La excepción de firma propia recae en el
   * mismo rol que ejecuta la prevención (`prevencionista` tiene
   * `prevention:sign_own_work` y a la vez investiga, redacta la MIPER y
   * propone la CAPA). Lo que se corrigió: ejercerla dejó de ser invisible. El
   * cierre devuelve si hizo falta la excepción, y el expediente lo dice; antes
   * un cierre firmado por quien investigó quedaba idéntico a uno firmado por
   * dos personas distintas.
   */
  it("dice cuándo el cierre necesitó la excepción de firma propia", () => {
    const conExcepcion = assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close", "prevention:sign_own_work"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: INVESTIGADOR,
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })
    expect(conExcepcion.ownWorkExceptionUsed).toBe(true)
  })

  it("no consume la excepción cuando la investigación la firmó otra persona", () => {
    const sinExcepcion = assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close", "prevention:sign_own_work"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: "otra-persona",
      capaStatuses: ["closed"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })
    // Tener el permiso no significa haberlo usado: si no había a quién
    // separar, la excepción no se consumió y no hay nada que registrar.
    expect(sinExcepcion.ownWorkExceptionUsed).toBe(false)
  })

  /* La exención levanta el eslabón del actor, no las compuertas de estado: con
   * `sign_own_work` igual no se cierra un caso con CAPA abiertas. */
  it("does not let the exemption skip the state gates", () => {
    expect(() => assertIncidentTransition({
      incident,
      toStatus: "closed",
      permissions: ["prevention:incidents:close", "prevention:sign_own_work"],
      investigationCompleted: true,
      investigationCompletedByUserId: INVESTIGADOR,
      actorUserId: INVESTIGADOR,
      capaStatuses: ["verified"],
      notificationLanes: [{ notificationType: "diat", status: "sent", evidenceReference: "folio-1" }],
    })).toThrow(/CAPA deben estar cerradas/i)
  })

})
