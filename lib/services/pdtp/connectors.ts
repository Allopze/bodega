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
  /** Dónde se registra el hecho, si no es la portada del módulo (ver EPP). */
  startModuleHref?: string
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
      return startHref(input.startModuleHref ?? input.moduleHref, instance)
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
    configurePermission: "prevention:training:record", executePermission: "prevention:training:record",
    supportedBindingSourceTypes: ["capacitacion", "capacitacion_ocurrencia"],
    // M-22 (auditoría 2026-09-28): `session_closed` nadie lo emitía desde que se
    // retiraron los cursos por persona; la capacitación acredita por ocurrencia.
    supportedEvents: [],
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
    // PRV-19 #12 (auditoría 2026-09-28): la entrega se registra en Bodega; la
    // matriz de EPP no registra entregas y dejaba "Iniciar" sin salida.
    key: "epp", label: "EPP", moduleHref: "/prevencion/epp-preventivo", startModuleHref: "/entregas",
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
    // Sin "meeting_closed": la reunión mensual del comité (antes N°13) salió
    // del PDTP por decisión D5 y no acredita ninguna actividad del catálogo
    // (`closeCommitteeMeeting` lo declara explícitamente). Este evento estuvo
    // declarado acá sin que nada lo emitiera nunca — un binding admin sobre él
    // habría quedado configurado y muerto para siempre. Desde la Task 10,
    // cerrar el acta sí completa algo, pero es la sesión del programa LOCAL
    // del comité (`prevention_committee_program_activities`), no un evento de
    // este registro de conectores PDTP.
    supportedEvents: [
      { key: "committee_constituted", label: "Comité CPHS constituido", sourceType: "cphs" },
      { key: "management_review_closed", label: "Revisión por la dirección cerrada", sourceType: "cphs" },
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

/**
 * Si el hecho de una fuente puede cumplir una ocurrencia cuyo destino es este
 * conector (PREV-I08-f).
 *
 * Acepta por los tipos de fuente de sus eventos **y** por los de sus bindings.
 * Antes sólo miraba los eventos: Capacitación declara el binding
 * `capacitacion_ocurrencia` pero su único evento es de `capacitacion`, e
 * Higiene declara `vigilancia` con un evento sólo de `higiene`, así que esas
 * ocurrencias nunca se enlazaban. No se agregan eventos nuevos al registro:
 * `supportedEvents` también habilita disparadores configurables y un evento
 * que nadie emite dejaría disparadores muertos.
 *
 * - `eventKey`, si llega, sólo filtra contra los eventos de ese mismo tipo de
 *   fuente; una fuente sin eventos propios (sólo binding) no se invalida.
 * - `bindingSourceType` es el tipo de fuente del instrumento que la actividad
 *   fijó en su configuración anual: si lo fijó, sólo ese tipo cumple.
 */
export function pdtpConnectorAcceptsFulfillmentSource(input: {
  connectorKey: string | null | undefined
  sourceType: string
  eventKey?: string | null
  bindingSourceType?: string | null
}): boolean {
  const connector = getPdtpExecutionConnector(input.connectorKey)
  if (!connector) return false
  if (input.bindingSourceType && input.bindingSourceType !== input.sourceType) return false
  const eventsOfSource = connector.supportedEvents.filter((event) => event.sourceType === input.sourceType)
  const eventKey = input.eventKey?.trim()
  if (eventsOfSource.length > 0) {
    return !eventKey || eventsOfSource.some((event) => event.key === eventKey)
  }
  return connector.supportedBindingSourceTypes.includes(input.sourceType)
}
