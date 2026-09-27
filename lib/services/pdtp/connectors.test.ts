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

// PREV-I08-f: una ocurrencia se enlaza al hecho de su fuente aunque la fuente
// sólo esté declarada como instrumento (binding) del conector. Antes sólo se
// miraban los eventos: la ocurrencia de capacitación y el control de vigilancia
// nunca enlazaban su instancia.
describe("pdtpConnectorAcceptsFulfillmentSource", () => {
  it("acepta las fuentes declaradas como binding además de las de sus eventos", async () => {
    const { pdtpConnectorAcceptsFulfillmentSource } = await import("@/lib/services/pdtp/connectors")
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "training", sourceType: "capacitacion" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "training", sourceType: "capacitacion_ocurrencia" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "hygiene", sourceType: "higiene" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "hygiene", sourceType: "vigilancia" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "inspections", sourceType: "campana" })).toBe(false)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "no-existe", sourceType: "inspeccion" })).toBe(false)
  })

  it("el eventKey sólo filtra contra los eventos de ese mismo tipo de fuente", async () => {
    const { pdtpConnectorAcceptsFulfillmentSource } = await import("@/lib/services/pdtp/connectors")
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "hygiene", sourceType: "higiene", eventKey: "measurement_completed" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "hygiene", sourceType: "higiene", eventKey: "otro_evento" })).toBe(false)
    // `vigilancia` no tiene eventos propios: un eventKey no la vuelve inválida.
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "hygiene", sourceType: "vigilancia", eventKey: "measurement_completed" })).toBe(true)
  })

  it("si la actividad fija un instrumento, la fuente tiene que ser la de ese binding", async () => {
    const { pdtpConnectorAcceptsFulfillmentSource } = await import("@/lib/services/pdtp/connectors")
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "training", sourceType: "capacitacion_ocurrencia", bindingSourceType: "capacitacion_ocurrencia" })).toBe(true)
    expect(pdtpConnectorAcceptsFulfillmentSource({ connectorKey: "training", sourceType: "capacitacion", bindingSourceType: "capacitacion_ocurrencia" })).toBe(false)
  })
})
