import { describe, expect, it } from "vitest"
import {
  getPdtpExecutionConnector,
  listPdtpExecutionConnectors,
  type PdtpExecutableInstance,
} from "@/lib/services/pdtp/connectors"

describe("PDTP execution connector registry", () => {
  it("declares the real prevention destinations without activity-number branching", () => {
    const keys = listPdtpExecutionConnectors().map((connector) => connector.key)
    expect(keys).toEqual([
      "inspections", "training", "campaigns", "documentation", "emergencies", "incidents",
      "hygiene", "alcotest", "miper", "epp", "cphs", "cgrd", "indicators", "worker",
    ])
    for (const connector of listPdtpExecutionConnectors()) {
      expect(connector.moduleHref).toMatch(/^\/prevencion\//)
      expect(connector.configurePermission).toMatch(/^prevention:|^sst:/)
      expect(connector.executePermission).toMatch(/^prevention:|^sst:/)
      expect(connector.supportedCompletionPolicies.length).toBeGreaterThan(0)
      expect(connector.supportedEvidenceKinds.length).toBeGreaterThan(0)
      expect(connector.listInstruments).toBeTypeOf("function")
      expect(connector.buildStartHref).toBeTypeOf("function")
    }
  })

  it("exposes event and completion capabilities for a selected connector", () => {
    const training = getPdtpExecutionConnector("training")
    expect(training).toBeDefined()
    expect(training?.supportedEvents.some((event) => event.key === "session_closed")).toBe(true)
    expect(training?.supportedCompletionPolicies).toContain("source_completed")
    expect(training?.supportedEvidenceKinds).toContain("generated_record")
  })

  it("builds a contextual native-module URL from an executable instance", () => {
    const instance: PdtpExecutableInstance = {
      id: "instance-1",
      programId: "program-1",
      activityId: "activity-1",
      worksiteId: "worksite-1",
      instrumentId: "instrument-1",
    }
    const href = getPdtpExecutionConnector("inspections")?.buildStartHref(instance)
    expect(href).toContain("/prevencion/inspecciones")
    expect(href).toContain("instancia=instance-1")
    expect(href).toContain("actividad=activity-1")
    expect(href).toContain("faena=worksite-1")
  })

  it("hidrata instrumentos desde vínculos persistidos del conector", async () => {
    const inspections = getPdtpExecutionConnector("inspections")
    const instruments = await inspections!.listInstruments([
      { id: "inspection-template-1", sourceType: "inspeccion", sourceId: "tpl-1", eventType: "execute", catalogActivityId: "catalog-1" },
      { id: "training-course-1", sourceType: "capacitacion", sourceId: "course-1", eventType: "close", catalogActivityId: "catalog-1" },
    ])

    expect(instruments).toEqual([expect.objectContaining({
      id: "inspection-template-1",
      sourceType: "inspeccion",
      catalogActivityId: "catalog-1",
      label: "inspeccion · tpl-1 · execute",
    })])
  })

  it("does not invent a connector for an unknown key", () => {
    expect(getPdtpExecutionConnector("activity-number-25")).toBeUndefined()
  })
})
