import type { PdtpScheduledInstance } from "@/db/schema"
import type { Permission } from "@/modules/permissions"

export type PdtpCompletionPolicy = "manual_confirmed" | "source_completed" | "source_approved" | "checklist_completed"
export type PdtpEvidenceKind = "file" | "photo" | "checklist" | "signature" | "generated_record"

export type PdtpConnectorEvent = {
  key: string
  label: string
  sourceType: string
}

export type ConnectorInstrument = {
  id: string
  label: string
  sourceType?: string
  catalogActivityId?: string
  metadata?: Record<string, unknown>
}

export type PdtpConnectorBinding = {
  id: string
  sourceType: string
  sourceId: string
  eventType: string
  catalogActivityId: string
}

export type PdtpExecutableInstance = Pick<PdtpScheduledInstance, "id" | "programId" | "activityId" | "worksiteId"> & {
  instrumentId?: string | null
}

export interface PdtpExecutionConnector {
  key: string
  label: string
  moduleHref: string
  configurePermission: Permission
  executePermission: Permission
  supportedEvents: readonly PdtpConnectorEvent[]
  supportedBindingSourceTypes: readonly string[]
  supportedCompletionPolicies: readonly PdtpCompletionPolicy[]
  supportedEvidenceKinds: readonly PdtpEvidenceKind[]
  listInstruments(bindings?: readonly PdtpConnectorBinding[]): Promise<ConnectorInstrument[]>
  buildStartHref(instance: PdtpExecutableInstance): string
}

const ALL_MANUAL_EVIDENCE: readonly PdtpEvidenceKind[] = ["file", "photo", "checklist", "signature", "generated_record"]

function startHref(moduleHref: string, instance: PdtpExecutableInstance): string {
  const params = new URLSearchParams({
    faena: instance.worksiteId,
    programa: instance.programId,
    actividad: instance.activityId,
    instancia: instance.id,
  })
  if (instance.instrumentId) params.set("instrumento", instance.instrumentId)
  return `${moduleHref}?${params.toString()}`
}

function connector(input: Omit<PdtpExecutionConnector, "listInstruments" | "buildStartHref" | "supportedBindingSourceTypes"> & {
  supportedBindingSourceTypes?: readonly string[]
}): PdtpExecutionConnector {
  return {
    ...input,
    supportedBindingSourceTypes: input.supportedBindingSourceTypes ?? [],
    async listInstruments(bindings = []) {
      const supported = new Set(input.supportedBindingSourceTypes ?? [])
      return bindings
        .filter((binding) => supported.has(binding.sourceType))
        .map((binding) => ({
          id: binding.id,
          sourceType: binding.sourceType,
          catalogActivityId: binding.catalogActivityId,
          label: `${binding.sourceType} · ${binding.sourceId} · ${binding.eventType}`,
          metadata: { sourceId: binding.sourceId, eventType: binding.eventType },
        }))
    },
    buildStartHref(instance) {
      return startHref(input.moduleHref, instance)
    },
  }
}

const CONNECTORS: readonly PdtpExecutionConnector[] = [
  connector({
    key: "inspections", label: "Inspecciones", moduleHref: "/prevencion/inspecciones",
    configurePermission: "prevention:inspections:manage", executePermission: "prevention:inspections:execute",
    supportedBindingSourceTypes: ["inspeccion"],
    supportedEvents: [{ key: "inspection_completed", label: "Inspección completada", sourceType: "inspeccion" }],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed", "checklist_completed"],
    supportedEvidenceKinds: ALL_MANUAL_EVIDENCE,
  }),
  connector({
    key: "training", label: "Capacitación", moduleHref: "/prevencion/capacitacion",
    configurePermission: "prevention:training:manage", executePermission: "prevention:training:deliver",
    supportedBindingSourceTypes: ["capacitacion", "capacitacion_ocurrencia"],
    supportedEvents: [{ key: "session_closed", label: "Sesión cerrada", sourceType: "capacitacion" }],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ["file", "photo", "signature", "generated_record"],
  }),
  connector({
    key: "campaigns", label: "Campañas", moduleHref: "/prevencion/campanas",
    configurePermission: "prevention:campaign:manage", executePermission: "prevention:campaign:manage",
    supportedBindingSourceTypes: ["campana"],
    supportedEvents: [{ key: "campaign_closed", label: "Campaña cerrada", sourceType: "campana" }],
    supportedCompletionPolicies: ["source_completed", "manual_confirmed"],
    supportedEvidenceKinds: ["file", "photo", "signature", "generated_record"],
  }),
  connector({
    key: "documentation", label: "Documentación", moduleHref: "/prevencion/documentacion",
    configurePermission: "prevention:docs:manage", executePermission: "prevention:docs:publish",
    supportedBindingSourceTypes: ["documento"],
    supportedEvents: [
      { key: "document_published", label: "Documento publicado", sourceType: "documento" },
      { key: "document_acknowledged", label: "Documento acusado", sourceType: "documento" },
    ],
    supportedCompletionPolicies: ["source_completed", "source_approved"],
    supportedEvidenceKinds: ["file", "generated_record"],
  }),
  connector({
    key: "emergencies", label: "Emergencias", moduleHref: "/prevencion/emergencias",
    configurePermission: "prevention:emergency:manage", executePermission: "prevention:emergency:drill_execute",
    supportedBindingSourceTypes: ["emergencia"],
    supportedEvents: [
      { key: "drill_completed", label: "Simulacro completado", sourceType: "emergencia" },
      { key: "plan_approved", label: "Plan aprobado", sourceType: "emergencia" },
    ],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ALL_MANUAL_EVIDENCE,
  }),
  connector({
    key: "incidents", label: "Incidentes", moduleHref: "/prevencion/incidentes",
    configurePermission: "prevention:incidents:investigate", executePermission: "prevention:incidents:investigate",
    supportedBindingSourceTypes: ["incident"],
    supportedEvents: [
      { key: "incident_registered", label: "Incidente registrado", sourceType: "incident" },
      { key: "incident_closed", label: "Incidente cerrado", sourceType: "incident" },
    ],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ["file", "photo", "signature", "generated_record"],
  }),
  connector({
    key: "hygiene", label: "Higiene y vigilancia", moduleHref: "/prevencion/higiene",
    configurePermission: "prevention:hygiene:assess", executePermission: "prevention:hygiene:measure",
    supportedBindingSourceTypes: ["higiene", "vigilancia"],
    supportedEvents: [{ key: "measurement_completed", label: "Medición completada", sourceType: "higiene" }],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ["file", "photo", "generated_record"],
  }),
  connector({
    key: "alcotest", label: "Alcotest", moduleHref: "/prevencion/alcotest",
    configurePermission: "prevention:alcotest:dispatch", executePermission: "prevention:alcotest:register",
    supportedBindingSourceTypes: ["alcotest"],
    supportedEvents: [{ key: "test_registered", label: "Alcotest registrado", sourceType: "alcotest" }],
    supportedCompletionPolicies: ["source_completed", "manual_confirmed"],
    supportedEvidenceKinds: ["generated_record", "file"],
  }),
  connector({
    key: "miper", label: "MIPER y requisitos legales", moduleHref: "/prevencion/miper",
    configurePermission: "prevention:risk:edit", executePermission: "prevention:risk:publish",
    supportedBindingSourceTypes: ["miper", "requisito_legal"],
    supportedEvents: [{ key: "review_published", label: "Revisión publicada", sourceType: "miper" }],
    supportedCompletionPolicies: ["source_completed", "source_approved"],
    supportedEvidenceKinds: ["file", "generated_record"],
  }),
  connector({
    key: "epp", label: "EPP", moduleHref: "/prevencion/epp-preventivo",
    configurePermission: "prevention:epp:manage", executePermission: "prevention:epp:manage",
    supportedBindingSourceTypes: ["epp"],
    supportedEvents: [{ key: "delivery_completed", label: "Entrega de EPP completada", sourceType: "epp" }],
    supportedCompletionPolicies: ["source_completed", "manual_confirmed"],
    supportedEvidenceKinds: ["signature", "photo", "generated_record", "file"],
  }),
  connector({
    key: "cphs", label: "CPHS", moduleHref: "/prevencion/cphs",
    configurePermission: "prevention:cphs:manage", executePermission: "prevention:governance:review",
    supportedBindingSourceTypes: ["cphs"],
    supportedEvents: [
      { key: "committee_constituted", label: "Comité CPHS constituido", sourceType: "cphs" },
      { key: "management_review_closed", label: "Revisión por la dirección cerrada", sourceType: "cphs" },
      { key: "meeting_closed", label: "Reunión CPHS cerrada", sourceType: "cphs" },
    ],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ["signature", "file", "generated_record"],
  }),
  connector({
    key: "cgrd", label: "CGRD", moduleHref: "/prevencion/cgrd",
    configurePermission: "prevention:cgrd:matrix:edit", executePermission: "prevention:cgrd:matrix:publish",
    supportedBindingSourceTypes: ["cgrd"],
    supportedEvents: [
      { key: "structure_established", label: "Estructura CGRD establecida", sourceType: "cgrd" },
      { key: "matrix_published", label: "Matriz publicada", sourceType: "cgrd" },
      { key: "meeting_closed", label: "Acta CGRD cerrada", sourceType: "cgrd" },
    ],
    supportedCompletionPolicies: ["source_completed", "source_approved"],
    supportedEvidenceKinds: ["signature", "file", "generated_record"],
  }),
  connector({
    key: "indicators", label: "Indicadores", moduleHref: "/prevencion/indicadores",
    configurePermission: "prevention:indicadores:manage", executePermission: "prevention:indicadores:close",
    supportedBindingSourceTypes: ["indicadores"],
    supportedEvents: [{ key: "period_closed", label: "Período de indicadores cerrado", sourceType: "indicadores" }],
    supportedCompletionPolicies: ["source_completed", "source_approved"],
    supportedEvidenceKinds: ["generated_record", "file"],
  }),
  connector({
    key: "worker", label: "Habilitación del trabajador", moduleHref: "/prevencion/nueva",
    configurePermission: "prevention:pdtp:program:manage", executePermission: "sst:close",
    supportedBindingSourceTypes: ["evaluacion_sst"],
    supportedEvents: [{ key: "worker_created", label: "Ingreso de trabajador", sourceType: "evaluacion_sst" }],
    supportedCompletionPolicies: ["source_completed", "source_approved", "manual_confirmed"],
    supportedEvidenceKinds: ["signature", "file", "generated_record"],
  }),
]

const BY_KEY = new Map(CONNECTORS.map((item) => [item.key, item]))

export function listPdtpExecutionConnectors(): readonly PdtpExecutionConnector[] {
  return CONNECTORS
}

export function getPdtpExecutionConnector(key: string | null | undefined): PdtpExecutionConnector | undefined {
  return key ? BY_KEY.get(key) : undefined
}
