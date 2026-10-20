import { describe, expect, it } from "vitest"
import {
  TEMPLATE_NOTICE,
  changedPdtpAxes,
  filterPrograms,
  normalizeProgramFilters,
  numbersAccreditationNotice,
  officialSourceGate,
  pdtpSavePayload,
  programSubjectLabel,
  retireTemplateMessage,
  rollbackTemplateMessage,
  templateActionState,
  unmappedPdtpWarning,
  type ProgramFilterInput,
  type TemplateActionInput,
} from "./inspection-catalog-logic"

describe("acreditación PDTP: sólo se manda lo que cambió", () => {
  const preload = { execute: ["act-29"], review: ["act-26"] }

  it("sin tocar nada no hay ejes cambiados ni cuerpo que mandar (Guardar queda deshabilitado)", () => {
    expect(changedPdtpAxes({ execute: ["act-29"], review: ["act-26"] }, preload)).toEqual({ execute: false, review: false, any: false })
    expect(pdtpSavePayload({ execute: ["act-29"], review: ["act-26"] }, preload)).toEqual({})
  })

  it("el orden y los repetidos no cuentan como cambio", () => {
    const wide = { execute: ["a", "b"], review: [] }
    expect(changedPdtpAxes({ execute: ["b", "a", "a"], review: [] }, wide).any).toBe(false)
  })

  it("cambiar la ejecución no reescribe la revisión (omitir un eje lo conserva)", () => {
    const payload = pdtpSavePayload({ execute: ["act-29", "act-41"], review: ["act-26"] }, preload)
    expect(payload).toEqual({ catalogActivityIds: ["act-29", "act-41"] })
    expect(payload).not.toHaveProperty("reviewCatalogActivityIds")
  })

  it("vaciar un eje sí lo manda, y vacío: es la forma de apagarlo", () => {
    expect(pdtpSavePayload({ execute: ["act-29"], review: [] }, preload)).toEqual({ reviewCatalogActivityIds: [] })
  })

  it("los dos ejes cambiados viajan juntos", () => {
    expect(pdtpSavePayload({ execute: [], review: ["x"] }, preload)).toEqual({ catalogActivityIds: [], reviewCatalogActivityIds: ["x"] })
  })

  it("los avisos dicen lo que el plan escribe", () => {
    expect(numbersAccreditationNotice(["N° 29"])).toBe(
      "Hoy acredita por número de actividad (N° 29). Al guardar quedará vinculada a su actividad del catálogo.",
    )
    expect(unmappedPdtpWarning(29)).toBe(
      "N° 29 no tiene actividad en el catálogo corporativo: si guardas este eje sin elegir una, dejará de acreditar.",
    )
  })
})

describe("importar un anexo oficial: la fuente documental", () => {
  const CHECKSUM = "aaa111"
  const sources = [
    { id: "v-otro", checksumSha256: "zzz" },
    { id: "v-oficial", checksumSha256: CHECKSUM },
  ]

  it("un instrumento sin anexo oficial no la exige ni la preselecciona", () => {
    const gate = officialSourceGate({ needsOfficialSource: false, officialChecksumSha256: null, sources, selectedId: "" })
    expect(gate).toMatchObject({ required: false, preselectedId: "", noMatch: false, blocked: false })
    expect(gate.candidates).toHaveLength(2)
  })

  it("con el checksum conocido ofrece sólo el archivo que coincide y lo preselecciona", () => {
    const gate = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: CHECKSUM, sources, selectedId: "" })
    expect(gate.required).toBe(true)
    expect(gate.candidates.map((source) => source.id)).toEqual(["v-oficial"])
    expect(gate.preselectedId).toBe("v-oficial")
    expect(gate.noMatch).toBe(false)
  })

  it("es obligatoria: sin elegirla, con la coincidencia disponible, no se puede incorporar", () => {
    const blocked = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: CHECKSUM, sources, selectedId: "" })
    expect(blocked.blocked).toBe(true)
    const chosen = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: CHECKSUM, sources, selectedId: "v-oficial" })
    expect(chosen.blocked).toBe(false)
  })

  it("si la Biblioteca no tiene el archivo avisa en vez de bloquear: se vincula después", () => {
    const gate = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: "no-esta", sources, selectedId: "" })
    expect(gate).toMatchObject({ required: true, noMatch: true, blocked: false, preselectedId: "" })
    expect(gate.candidates).toEqual([])
  })

  it("sin checksum conocido (respaldo exigido igual) elige a mano entre las fuentes vigentes", () => {
    const gate = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: null, sources, selectedId: "" })
    expect(gate).toMatchObject({ required: true, noMatch: false, blocked: true, preselectedId: "" })
    expect(gate.candidates).toHaveLength(2)
  })

  it("con la Biblioteca vacía no hay con qué cumplirla y no bloquea", () => {
    expect(officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: null, sources: [], selectedId: "" }).blocked).toBe(false)
  })
})

describe("acciones de una plantilla: lo que el servidor rechazaría se dice, no se ofrece", () => {
  const draftOfficial: TemplateActionInput = {
    status: "draft",
    provenanceKind: "official_document",
    authorUserId: "autor",
    sourceDocumentVersionId: null,
    parityReport: { status: "pending", differences: [] },
    recordsDeviations: false,
  }
  const approver = { canManage: true, canApprove: true, currentUserId: "otra-persona" }

  it("un anexo oficial sin planilla: «Falta vincular la planilla oficial.», sin Aprobar ni Declarar paridad", () => {
    const state = templateActionState(draftOfficial, approver)
    expect(state.notice).toBe(TEMPLATE_NOTICE.missingSource)
    expect(state.notice).toBe("Falta vincular la planilla oficial.")
    expect(state).toMatchObject({ approve: false, declareParity: false, requestApproval: false, linkSource: "Vincular fuente" })
  })

  it("con la planilla vinculada y la paridad pendiente: declara otra persona, y aprobar espera", () => {
    const linked = { ...draftOfficial, sourceDocumentVersionId: "v1" }
    const state = templateActionState(linked, approver)
    expect(state).toMatchObject({ declareParity: true, approve: false, linkSource: "Cambiar fuente" })
    expect(state.notice).toBe("Se aprueba después de declarar la paridad sin diferencias.")
  })

  it("quien incorporó la plantilla no puede declarar su paridad: no se le ofrece y se le dice quién", () => {
    const linked = { ...draftOfficial, sourceDocumentVersionId: "v1" }
    const state = templateActionState(linked, { ...approver, currentUserId: "autor" })
    expect(state.declareParity).toBe(false)
    expect(state.approve).toBe(false)
    expect(state.notice).toBe("La paridad la declara otra persona con permiso de aprobación.")
  })

  it("una paridad con diferencias no habilita Aprobar aunque se haya declarado", () => {
    const failed = { ...draftOfficial, sourceDocumentVersionId: "v1", parityReport: { status: "failed", differences: ["Falta un ítem"] } }
    const state = templateActionState(failed, approver)
    expect(state.approve).toBe(false)
    expect(state.declareParity).toBe(true)
  })

  it("paridad aprobada sin diferencias: ya se aprueba, sin aviso", () => {
    const ready = { ...draftOfficial, sourceDocumentVersionId: "v1", parityReport: { status: "passed", differences: [] } }
    const state = templateActionState(ready, approver)
    expect(state).toMatchObject({ approve: true, notice: null })
  })

  it("una definición de plataforma no pide fuente ni paridad", () => {
    const state = templateActionState({ ...draftOfficial, provenanceKind: "platform_definition" }, approver)
    expect(state).toMatchObject({ approve: true, notice: null, linkSource: null, declareParity: false })
  })

  it("quien sólo administra pide la aprobación cuando ya es aprobable, y no antes", () => {
    const manager = { canManage: true, canApprove: false, currentUserId: "m" }
    expect(templateActionState({ ...draftOfficial, provenanceKind: "platform_definition" }, manager).requestApproval).toBe(true)
    expect(templateActionState(draftOfficial, manager).requestApproval).toBe(false)
    // Con la planilla puesta y la paridad pendiente, el aviso lo dice sin prometerle Aprobar.
    expect(templateActionState({ ...draftOfficial, sourceDocumentVersionId: "v1" }, manager).notice)
      .toBe("La paridad la declara otra persona con permiso de aprobación.")
  })

  it("«Vincular fuente» es de quien administra y sólo en un borrador", () => {
    expect(templateActionState(draftOfficial, { canManage: false, canApprove: true, currentUserId: "x" }).linkSource).toBeNull()
    expect(templateActionState({ ...draftOfficial, status: "approved" }, approver).linkSource).toBeNull()
  })

  it("el catálogo de desviaciones sólo existe donde se registran desviaciones y para quien administra", () => {
    const records = { ...draftOfficial, recordsDeviations: true }
    expect(templateActionState(records, approver).deviations).toBe(true)
    expect(templateActionState(draftOfficial, approver).deviations).toBe(false)
    expect(templateActionState(records, { canManage: false, canApprove: true, currentUserId: "x" }).deviations).toBe(false)
  })

  it("una plantilla retirada no ofrece nada que cambiar", () => {
    const retired = { ...draftOfficial, status: "superseded", recordsDeviations: true }
    expect(templateActionState(retired, approver)).toMatchObject({ pdtp: false, deviations: false, retire: false, approve: false, linkSource: null, notice: null })
  })

  it("quien sólo mira no ve avisos ni acciones", () => {
    const viewer = { canManage: false, canApprove: false, currentUserId: "v" }
    expect(templateActionState(draftOfficial, viewer)).toMatchObject({
      notice: null, approve: false, retire: false, pdtp: false, deviations: false, linkSource: null, declareParity: false, requestApproval: false,
    })
  })
})

describe("retirar y revertir: el resultado se dice con lo que pasó", () => {
  it("borrada sin uso", () => {
    expect(retireTemplateMessage({ outcome: "deleted", runs: 0, programs: 0, activePrograms: 0 }))
      .toBe("Plantilla eliminada: no tenía inspecciones ni programaciones.")
  })

  it("retirada con inspecciones: se conservan, y las programaciones activas dejan de generar", () => {
    expect(retireTemplateMessage({ outcome: "superseded", runs: 3, programs: 2, activePrograms: 2 }))
      .toBe("Plantilla retirada. Se conservan 3 inspecciones. 2 programaciones activas ya no generarán inspecciones: revísalas en Programación.")
  })

  it("en singular y sin programaciones activas no inventa la segunda frase", () => {
    expect(retireTemplateMessage({ outcome: "superseded", runs: 1, programs: 1, activePrograms: 0 }))
      .toBe("Plantilla retirada. Se conservan 1 inspección.")
    expect(retireTemplateMessage({ outcome: "superseded", runs: 0, programs: 1, activePrograms: 1 }))
      .toBe("Plantilla retirada. 1 programación activa ya no generará inspecciones: revísala en Programación.")
  })

  it("sin datos del servidor cae en el mensaje mínimo", () => {
    expect(retireTemplateMessage(undefined)).toBe("Plantilla retirada.")
  })

  it("revertir dice a qué versión se volvió y cuánto pasó a ella", () => {
    expect(rollbackTemplateMessage("v1", { restored: "t", programs: 2, plannedRuns: 1 }))
      .toBe("Se volvió a la versión v1. Pasaron a ella 2 programaciones y 1 inspección planificada.")
    expect(rollbackTemplateMessage("v1", undefined)).toBe("Se volvió a la versión v1.")
  })
})

describe("programación: sujeto y filtros", () => {
  const program = (over: Partial<ProgramFilterInput> = {}): ProgramFilterInput => ({
    templateName: "Inspección de Estado de Extintores",
    worksiteId: "ws-1",
    worksiteName: "Teno - Arauco",
    subjectLabel: null,
    subjectType: null,
    riskLabel: null,
    assigneeName: null,
    isActive: true,
    templateApproved: true,
    nextDueOn: "2026-10-30",
    ...over,
  })
  const TODAY = "2026-10-19"

  it("el sujeto elegido del inventario manda; luego el tipo escrito; luego «Sin sujeto definido»", () => {
    expect(programSubjectLabel(program({ subjectLabel: "KA122", subjectType: "camion" }))).toBe("KA122")
    expect(programSubjectLabel(program({ subjectType: "camion" }))).toBe("Camión")
    expect(programSubjectLabel(program({ subjectType: "Sala eléctrica" }))).toBe("Sala eléctrica")
    expect(programSubjectLabel(program())).toBe("Sin sujeto definido")
  })

  it("«Vencidas» es una vista: estado=overdue (enlaces viejos) se lee como vista=vencidas", () => {
    expect(normalizeProgramFilters({ estado: "overdue", vista: null })).toEqual({ status: "all", overdueView: true })
    expect(normalizeProgramFilters({ estado: null, vista: "vencidas" })).toEqual({ status: "all", overdueView: true })
    expect(normalizeProgramFilters({ estado: "paused", vista: null })).toEqual({ status: "paused", overdueView: false })
    expect(normalizeProgramFilters({ estado: "active", vista: "otra-cosa" })).toEqual({ status: "active", overdueView: false })
    expect(normalizeProgramFilters({})).toEqual({ status: "all", overdueView: false })
  })

  it("la búsqueda alcanza el nombre del sujeto del inventario", () => {
    const programs = [program({ subjectLabel: "Contenedor C-12 · Patio" }), program({ subjectLabel: "KA122" })]
    const found = filterPrograms(programs, { query: "c-12", status: "all", worksite: "all", overdueView: false, today: TODAY })
    expect(found).toHaveLength(1)
    expect(found[0]?.subjectLabel).toBe("Contenedor C-12 · Patio")
  })

  it("la vista vencidas deja sólo las activas con plantilla aprobada y fecha pasada", () => {
    const programs = [
      program({ nextDueOn: "2026-10-01" }),
      program({ nextDueOn: "2026-10-01", isActive: false }),
      program({ nextDueOn: "2026-10-01", templateApproved: false }),
      program({ nextDueOn: "2026-11-01" }),
    ]
    const found = filterPrograms(programs, { query: "", status: "all", worksite: "all", overdueView: true, today: TODAY })
    expect(found).toHaveLength(1)
    expect(found[0]?.nextDueOn).toBe("2026-10-01")
  })

  it("estado y faena filtran por separado", () => {
    const programs = [program(), program({ isActive: false }), program({ worksiteId: "ws-2" })]
    expect(filterPrograms(programs, { query: "", status: "paused", worksite: "all", overdueView: false, today: TODAY })).toHaveLength(1)
    expect(filterPrograms(programs, { query: "", status: "active", worksite: "ws-1", overdueView: false, today: TODAY })).toHaveLength(1)
  })
})
