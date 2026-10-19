// @vitest-environment jsdom

import type { ComponentProps } from "react"
import Link from "next/link"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ImportTemplateDialog,
  InspectionProgramsPanel,
  InspectionTemplatesPanel,
  type ImportableDefinition,
  type TemplateItem,
} from "./inspection-catalog"

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.params,
  usePathname: () => "/prevencion/inspecciones/plantillas",
}))

const actions = vi.hoisted(() => ({
  approveInspectionTemplateAction: vi.fn(),
  retireInspectionTemplateAction: vi.fn(),
  createInspectionProgramAction: vi.fn(),
  importInspectionTemplateAction: vi.fn(),
  linkInspectionTemplateSourceAction: vi.fn(),
  remindTemplateApprovalAction: vi.fn(),
  rollbackInspectionTemplateAction: vi.fn(),
  runProgramNowAction: vi.fn(),
  setInspectionTemplateParityAction: vi.fn(),
  setInspectionTemplatePdtpActivitiesAction: vi.fn(),
  promoteUnclassifiedDeviationAction: vi.fn(),
  setTemplateDeviationAction: vi.fn(),
  updateInspectionProgramAction: vi.fn(),
}))
vi.mock("./actions", () => actions)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

const template = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  id: "t1",
  code: "inspeccion_contenedores",
  versionLabel: "v1",
  name: "Inspección de Contenedores",
  kind: "inspection",
  status: "draft",
  supersededByTemplateId: null,
  authorUserId: "autor",
  version: 3,
  coverage: { totalItems: 10, withDanoPotencial: 8, withRequired: 5, criticalityInert: false },
  pdtpActivityNumbers: [29],
  pdtpReviewActivityNumbers: null,
  pdtpAccreditation: { source: "numbers", executeSource: "numbers", reviewSource: "none", execute: ["N° 29 — Inspección de contenedores"], review: [] },
  pdtpPreloadExecuteIds: [],
  pdtpPreloadReviewIds: [],
  pdtpUnmappedNumbers: { execute: [29], review: [] },
  deviations: [],
  unclassifiedDeviations: [],
  recordsDeviations: false,
  sourceDefinitionCode: "inspeccion_contenedores",
  executorOfRecord: "platform_user",
  definitionDrifted: false,
  definitionMissing: false,
  provenanceKind: "platform_definition",
  needsOfficialSource: false,
  officialChecksumSha256: null,
  sourceDocumentVersionId: null,
  sourceSnapshot: null,
  parityReport: { status: "passed", differences: [] },
  contentHash: "hash-0123456789abcdef",
  ...over,
})

const source = (id: string, checksum: string) => ({
  id,
  documentId: `doc-${id}`,
  documentCode: `DOC-${id}`,
  documentTitle: `Documento ${id}`,
  fileName: `${id}.xlsx`,
  checksumSha256: checksum,
  status: "vigente",
  effectiveFrom: null,
})

const catalogActivities = [
  { id: "cat-29", code: "PDT-CONTENEDORES", title: "Inspección de contenedores", description: "Revisar los contenedores", status: "active" as const, annualNumber: null },
  { id: "cat-41", code: "PDT-ORDEN-ASEO", title: "Orden y aseo", description: "Verificar orden y aseo", status: "active" as const, annualNumber: null },
]

function renderTemplates(items: TemplateItem[], props: Partial<ComponentProps<typeof InspectionTemplatesPanel>> = {}) {
  return render(
    <InspectionTemplatesPanel
      templates={items}
      catalogActivities={catalogActivities}
      documentSources={[]}
      canManage
      canApprove
      currentUserId="otra-persona"
      {...props}
    />,
  )
}

/** La tabla y las tarjetas conviven en el DOM; la tabla es una sola. */
const table = () => within(screen.getByRole("table"))

const officialDraft = (over: Partial<TemplateItem> = {}) => template({
  provenanceKind: "official_document",
  needsOfficialSource: true,
  officialChecksumSha256: "abc",
  parityReport: { status: "pending", differences: [] },
  ...over,
})

describe("plantillas: estado y acciones que el servidor rechazaría", () => {
  it("una plantilla retirada se llama «Retirada» y una reemplazada «Reemplazada»", () => {
    renderTemplates([
      template({ id: "a", versionLabel: "v-retirada", status: "superseded", supersededByTemplateId: null }),
      template({ id: "b", versionLabel: "v-reemplazada", status: "superseded", supersededByTemplateId: "c" }),
    ])
    expect(table().getByText("Retirada")).toBeTruthy()
    expect(table().getByText("Reemplazada")).toBeTruthy()
  })

  it("un anexo oficial sin planilla dice qué falta en vez de ofrecer Aprobar y Declarar paridad", () => {
    renderTemplates([officialDraft()], { documentSources: [source("v1", "abc")] })
    expect(table().getByText("Falta vincular la planilla oficial.")).toBeTruthy()
    expect(table().queryByRole("button", { name: "Aprobar" })).toBeNull()
    expect(table().queryByRole("button", { name: "Declarar paridad" })).toBeNull()
    expect(table().getByRole("button", { name: "Vincular fuente" })).toBeTruthy()
  })

  it("con la planilla vinculada ofrece Declarar paridad y avisa que aprobar espera", () => {
    renderTemplates([officialDraft({ sourceDocumentVersionId: "v1" })])
    expect(table().getByText("Se aprueba después de declarar la paridad sin diferencias.")).toBeTruthy()
    expect(table().getByRole("button", { name: "Declarar paridad" })).toBeTruthy()
    expect(table().queryByRole("button", { name: "Aprobar" })).toBeNull()
  })

  it("quien incorporó la plantilla no ve Declarar paridad: se le dice que la declara otra persona", () => {
    renderTemplates([officialDraft({ sourceDocumentVersionId: "v1" })], { currentUserId: "autor" })
    expect(table().getByText("La paridad la declara otra persona con permiso de aprobación.")).toBeTruthy()
    expect(table().queryByRole("button", { name: "Declarar paridad" })).toBeNull()
  })

  it("con la paridad aprobada sin diferencias ya se puede aprobar", () => {
    renderTemplates([officialDraft({ sourceDocumentVersionId: "v1", parityReport: { status: "passed", differences: [] } })])
    expect(table().getByRole("button", { name: "Aprobar" })).toBeTruthy()
    expect(table().queryByText(/Falta vincular/)).toBeNull()
  })

  it("quien sólo mira no ve avisos ni botones de gestión", () => {
    renderTemplates([officialDraft()], { canManage: false, canApprove: false })
    expect(screen.queryByText("Falta vincular la planilla oficial.")).toBeNull()
    expect(screen.queryByRole("button", { name: "Vincular fuente" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull()
  })

  it("«Revertir versión» apunta a la versión que ESTA reemplazó, no a cualquier reemplazada del mismo código", () => {
    // Una retirada a propósito (sin reemplazo) también es `superseded` y comparte código.
    renderTemplates([
      template({ id: "vigente", versionLabel: "v3", status: "approved" }),
      template({ id: "retirada", versionLabel: "v1-retirada", status: "superseded", supersededByTemplateId: null }),
      template({ id: "reemplazada", versionLabel: "v2-reemplazada", status: "superseded", supersededByTemplateId: "vigente" }),
    ])
    fireEvent.click(table().getByRole("button", { name: "Revertir versión" }))
    expect(screen.getByRole("dialog").textContent).toContain("Volver a v2-reemplazada")
  })

  it("sin una versión que la actual haya reemplazado no hay nada a qué volver", () => {
    renderTemplates([
      template({ id: "vigente", versionLabel: "v3", status: "approved" }),
      template({ id: "retirada", versionLabel: "v1-retirada", status: "superseded", supersededByTemplateId: null }),
    ])
    expect(table().queryByRole("button", { name: "Revertir versión" })).toBeNull()
  })
})

describe("plantillas: desviaciones sólo donde existen", () => {
  it("«No aplica» en un instrumento que no registra desviaciones, y sin botón", () => {
    renderTemplates([template({ recordsDeviations: false })])
    expect(table().getByText("No aplica")).toBeTruthy()
    expect(table().queryByRole("button", { name: /^Desviaciones/ })).toBeNull()
  })

  it("en un instrumento que las registra, quien administra ve el botón y el conteo", () => {
    renderTemplates([template({ recordsDeviations: true })])
    expect(table().getByRole("button", { name: /^Desviaciones/ })).toBeTruthy()
    expect(table().getByText("Ninguna ofrecida")).toBeTruthy()
  })

  it("quien no administra ve «No aplica» aunque el instrumento las registre", () => {
    renderTemplates([template({ recordsDeviations: true })], { canManage: false })
    expect(table().getByText("No aplica")).toBeTruthy()
    expect(table().queryByRole("button", { name: /^Desviaciones/ })).toBeNull()
  })

  it("si la casilla falla, el motivo se ve como alerta junto a la fila", async () => {
    actions.setTemplateDeviationAction.mockResolvedValue({ ok: false, message: "La desviación ya no está vigente en el maestro." })
    renderTemplates([template({
      recordsDeviations: true,
      deviations: [{
        id: "d1", label: "Sin señalética", danoPotencial: "grave", isActive: true, criticality: "high",
        selected: false, danoPotencialOverride: null, effectiveDano: "grave", effectiveCriticality: "high",
      }],
    })])
    fireEvent.click(table().getByRole("button", { name: /^Desviaciones/ }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Sin señalética/ }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe("La desviación ya no está vigente en el maestro.")
    expect(alert.className).toContain("danger-ink")
  })
})

describe("plantillas: lo que acredita", () => {
  it("la tabla muestra la acreditación ya resuelta, con el número y el nombre de la actividad", () => {
    renderTemplates([template()])
    expect(table().getByText("Acreditará N° 29 — Inspección de contenedores al aprobarse")).toBeTruthy()
  })

  it("la acreditación del eje de revisión se muestra aparte", () => {
    renderTemplates([template({
      status: "approved",
      pdtpAccreditation: { source: "catalog", executeSource: "catalog", reviewSource: "catalog", execute: ["N° 25 — Ejecutar"], review: ["N° 26 — Revisar"] },
    })])
    expect(table().getByText("N° 25 — Ejecutar")).toBeTruthy()
    expect(table().getByText("N° 26 — Revisar")).toBeTruthy()
  })

  it("el diálogo avisa que acredita por número y que un número sin actividad dejará de acreditar", () => {
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Acreditación PDTP" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Hoy acredita por número de actividad (N° 29). Al guardar quedará vinculada a su actividad del catálogo.")).toBeTruthy()
    expect(within(dialog).getByText("N° 29 no tiene actividad en el catálogo corporativo: si guardas este eje sin elegir una, dejará de acreditar.")).toBeTruthy()
  })

  it("Guardar está deshabilitado sin cambios y manda sólo el eje que cambió", async () => {
    renderTemplates([template({
      status: "approved",
      pdtpAccreditation: { source: "catalog", executeSource: "catalog", reviewSource: "catalog", execute: ["N° 29"], review: ["N° 41"] },
      pdtpPreloadExecuteIds: ["cat-29"],
      pdtpPreloadReviewIds: ["cat-41"],
      pdtpUnmappedNumbers: { execute: [], review: [] },
    })])
    fireEvent.click(table().getByRole("button", { name: "Acreditación PDTP" }))
    const dialog = screen.getByRole("dialog")
    const save = within(dialog).getByRole("button", { name: "Guardar" })
    expect(save).toHaveProperty("disabled", true)

    // El selector de ejecución es el primero; se le suma la segunda actividad.
    fireEvent.click(within(dialog).getAllByRole("button", { name: /actividad(es)? seleccionadas?/ })[0]!)
    fireEvent.click(screen.getByRole("option", { name: /Orden y aseo/ }))
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toHaveProperty("disabled", false)
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(actions.setInspectionTemplatePdtpActivitiesAction).toHaveBeenCalledTimes(1))
    const input = actions.setInspectionTemplatePdtpActivitiesAction.mock.calls[0]?.[0]
    expect(input).toEqual({ templateId: "t1", expectedVersion: 3, catalogActivityIds: ["cat-29", "cat-41"] })
    expect(input).not.toHaveProperty("reviewCatalogActivityIds")
    expect(input).not.toHaveProperty("pdtpActivityNumbers")
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Acreditación PDTP actualizada."))
  })
})

describe("plantillas: vincular fuente", () => {
  it("abre con el archivo del anexo oficial preseleccionado y vincula con él", async () => {
    renderTemplates([officialDraft()], { documentSources: [source("v1", "abc"), source("v2", "zzz")] })
    fireEvent.click(table().getByRole("button", { name: "Vincular fuente" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Vincular planilla oficial · Inspección de Contenedores")).toBeTruthy()
    expect(within(dialog).getByText("La paridad se declara contra este archivo. Cambiarlo deja la paridad pendiente otra vez.")).toBeTruthy()

    fireEvent.click(within(dialog).getByRole("button", { name: "Vincular" }))
    await waitFor(() => expect(actions.linkInspectionTemplateSourceAction).toHaveBeenCalledTimes(1))
    expect(actions.linkInspectionTemplateSourceAction).toHaveBeenCalledWith({
      templateId: "t1",
      expectedVersion: 3,
      sourceDocumentVersionId: "v1",
      sourceRevision: undefined,
    })
  })

  it("si la Biblioteca no tiene el archivo avisa y no deja vincular", () => {
    renderTemplates([officialDraft()], { documentSources: [source("v2", "zzz")] })
    fireEvent.click(table().getByRole("button", { name: "Vincular fuente" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial/)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Vincular" })).toHaveProperty("disabled", true)
  })

  it("un rechazo del servidor queda dentro del diálogo, como alerta", async () => {
    actions.linkInspectionTemplateSourceAction.mockResolvedValue({ ok: false, message: "Sólo un borrador puede cambiar su fuente documental." })
    renderTemplates([officialDraft()], { documentSources: [source("v1", "abc")] })
    fireEvent.click(table().getByRole("button", { name: "Vincular fuente" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Vincular" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe("Sólo un borrador puede cambiar su fuente documental.")
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})

describe("plantillas: retirar", () => {
  const approved = () => template({ status: "approved" })

  async function retire(reason = "Instrumento reemplazado por otro código.") {
    fireEvent.click(table().getByRole("button", { name: "Retirar" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(dialog.querySelector('textarea[name="reason"]')!, { target: { value: reason } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirar plantilla" }))
    return dialog
  }

  it("explica la consecuencia, pide un motivo con su pista y ofrece «Cancelar»", () => {
    renderTemplates([approved()])
    fireEvent.click(table().getByRole("button", { name: "Retirar" }))
    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toContain("Deja de poder programarse y ejecutarse. Si nunca se usó, se elimina. Si tiene inspecciones, queda como «Retirada» con sus respuestas intactas, y sus programaciones dejan de generar inspecciones.")
    expect(dialog.textContent).toContain("Queda en el historial.")
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy()
  })

  it("avisa cuántas programaciones activas dejaron de generar inspecciones", async () => {
    actions.retireInspectionTemplateAction.mockResolvedValue({ ok: true, data: { outcome: "superseded", runs: 4, programs: 2, activePrograms: 2 } })
    renderTemplates([approved()])
    await retire()
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1))
    expect(toastMock.success).toHaveBeenCalledWith(
      "Plantilla retirada. Se conservan 4 inspecciones. 2 programaciones activas ya no generarán inspecciones: revísalas en Programación.",
    )
    expect(actions.retireInspectionTemplateAction).toHaveBeenCalledWith({ templateId: "t1", reason: "Instrumento reemplazado por otro código." })
  })

  it("dice que la plantilla se eliminó cuando nunca se usó", async () => {
    actions.retireInspectionTemplateAction.mockResolvedValue({ ok: true, data: { outcome: "deleted", runs: 0, programs: 0, activePrograms: 0 } })
    renderTemplates([approved()])
    await retire()
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Plantilla eliminada: no tenía inspecciones ni programaciones."))
  })

  it("un error del servidor se queda en el diálogo y no se anuncia como éxito", async () => {
    actions.retireInspectionTemplateAction.mockResolvedValue({ ok: false, message: "La plantilla ya está retirada." })
    renderTemplates([approved()])
    const dialog = await retire()
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe("La plantilla ya está retirada.")
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("el error de un intento anterior no espera a quien vuelve a abrir el diálogo", async () => {
    actions.retireInspectionTemplateAction.mockResolvedValue({ ok: false, message: "La plantilla ya está retirada." })
    renderTemplates([approved()])
    const dialog = await retire()
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(table().getByRole("button", { name: "Retirar" }))
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull()
  })
})

describe("incorporar una plantilla", () => {
  const definition = (over: Partial<ImportableDefinition> = {}): ImportableDefinition => ({
    code: "inspeccion_contenedores",
    title: "Inspección de Contenedores",
    version: "1.0",
    sections: 3,
    items: 30,
    coverage: { totalItems: 30, withDanoPotencial: 30, withRequired: 30, criticalityInert: false },
    pdtpActivities: [{ n: 29, name: "Inspección de contenedores" }],
    defaultKind: "inspection",
    needsOfficialSource: true,
    officialChecksumSha256: "abc",
    ...over,
  })

  function openImport(importable: ImportableDefinition[], sources: ReturnType<typeof source>[]) {
    render(<ImportTemplateDialog importable={importable} templates={[]} documentSources={sources} />)
    fireEvent.click(screen.getByRole("button", { name: "Incorporar borrador" }))
    return screen.getByRole("dialog")
  }

  it("dice la verdad sobre la aprobación: alguien con permiso la aprueba, y puedes ser tú", () => {
    const dialog = openImport([definition()], [])
    expect(dialog.textContent).toContain("Se crea como borrador: todavía no puede programarse ni ejecutarse. Para habilitarla, alguien con permiso de aprobación —puedes ser tú— la revisa y la aprueba.")
    expect(dialog.textContent).not.toContain("Otra persona")
  })

  it("un anexo oficial llega con su planilla elegida y la incorpora con ella", async () => {
    const dialog = openImport([definition()], [source("v1", "abc"), source("v2", "zzz")])
    expect(within(dialog).getByText("Obligatoria: este instrumento transcribe un anexo oficial.")).toBeTruthy()
    expect((within(dialog).getByPlaceholderText("Buscar por código o nombre de archivo…") as HTMLInputElement).value).toBe("DOC-v1")

    fireEvent.click(within(dialog).getByRole("button", { name: "Incorporar como borrador" }))
    await waitFor(() => expect(actions.importInspectionTemplateAction).toHaveBeenCalledTimes(1))
    expect(actions.importInspectionTemplateAction.mock.calls[0]?.[0]).toMatchObject({
      definitionCode: "inspeccion_contenedores",
      sourceDocumentVersionId: "v1",
      kind: "inspection",
    })
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Plantilla incorporada como borrador."))
  })

  it("sin el archivo en la Biblioteca avisa y deja incorporar: se vincula después", async () => {
    const dialog = openImport([definition()], [source("v2", "zzz")])
    expect(within(dialog).getByText("No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial. Súbela en Documentación; también puedes vincularla después con «Vincular fuente».")).toBeTruthy()
    const submit = within(dialog).getByRole("button", { name: "Incorporar como borrador" })
    expect(submit).toHaveProperty("disabled", false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.importInspectionTemplateAction).toHaveBeenCalledTimes(1))
    expect(actions.importInspectionTemplateAction.mock.calls[0]?.[0]).toMatchObject({ definitionCode: "inspeccion_contenedores", sourceDocumentVersionId: undefined })
  })

  it("sin checksum conocido la fuente es obligatoria y no se incorpora hasta elegirla", () => {
    const dialog = openImport([definition({ officialChecksumSha256: null })], [source("v1", "abc")])
    expect(within(dialog).getByRole("button", { name: "Incorporar como borrador" })).toHaveProperty("disabled", true)
  })

  it("un instrumento sin anexo oficial no exige fuente", () => {
    const dialog = openImport([definition({ needsOfficialSource: false, officialChecksumSha256: null })], [source("v1", "abc")])
    expect(within(dialog).getByText("Opcional: este instrumento no transcribe un anexo oficial.")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Incorporar como borrador" })).toHaveProperty("disabled", false)
  })

  it("el tipo sale de la definición: una auditoría no entra como inspección", async () => {
    const dialog = openImport([definition({ code: "auditoria_sgsst", title: "Auditoría SGSST", needsOfficialSource: false, officialChecksumSha256: null, defaultKind: "audit", pdtpActivities: [] })], [])
    fireEvent.click(within(dialog).getByRole("button", { name: "Incorporar como borrador" }))
    await waitFor(() => expect(actions.importInspectionTemplateAction).toHaveBeenCalledTimes(1))
    expect(actions.importInspectionTemplateAction.mock.calls[0]?.[0]).toMatchObject({ definitionCode: "auditoria_sgsst", kind: "audit" })
  })

  it("un rechazo del servidor sale como alerta dentro del diálogo, que sigue abierto", async () => {
    actions.importInspectionTemplateAction.mockResolvedValue({ ok: false, message: 'Ya existe la versión "1.0" de la plantilla.' })
    const dialog = openImport([definition({ needsOfficialSource: false, officialChecksumSha256: null })], [])
    fireEvent.click(within(dialog).getByRole("button", { name: "Incorporar como borrador" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe('Ya existe la versión "1.0" de la plantilla.')
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})

describe("programación", () => {
  const program = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    templateId: "t1",
    worksiteId: "ws-1",
    templateName: "Inspección de Estado de Extintores",
    worksiteName: "Teno - Arauco",
    frequency: "monthly",
    intervalDays: 30,
    nextDueOn: "2099-01-01",
    assignedToUserId: null,
    assigneeName: null,
    riskEntryId: null,
    riskLabel: null,
    subjectType: null,
    subjectLabel: null,
    subjectResourceId: null,
    subjectVehicleId: null,
    subjectContainerId: null,
    templateDefinitionCode: null,
    isActive: true,
    templateApproved: true,
    version: 1,
    ...over,
  })

  function renderPrograms(programs: ReturnType<typeof program>[], props: Record<string, unknown> = {}) {
    return render(
      <InspectionProgramsPanel programs={programs as never} assignees={[]} canManage={false} {...props} />,
    )
  }

  const programTable = () => within(screen.getByRole("table"))

  it("el sujeto elegido del inventario se muestra por su nombre, no como «No especificado»", () => {
    renderPrograms([
      program({ id: "a", subjectLabel: "KA122", subjectType: "camion" }),
      program({ id: "b", subjectType: "camion" }),
      program({ id: "c" }),
    ])
    expect(programTable().getByText("KA122")).toBeTruthy()
    expect(programTable().getByText("Camión")).toBeTruthy()
    expect(programTable().getByText("Sin sujeto definido")).toBeTruthy()
    expect(screen.queryByText("No especificado")).toBeNull()
  })

  it("la búsqueda alcanza el nombre del sujeto", () => {
    nav.params = new URLSearchParams("q=ka122")
    renderPrograms([
      program({ id: "a", subjectLabel: "KA122" }),
      program({ id: "b", subjectLabel: "Contenedor C-12" }),
    ])
    expect(programTable().getByText("KA122")).toBeTruthy()
    expect(programTable().queryByText("Contenedor C-12")).toBeNull()
  })

  it("«Sólo vencidas» limpia el estado: la combinación vacía falsa deja de existir", () => {
    nav.params = new URLSearchParams("estado=paused&faena=ws-1")
    renderPrograms([program()])
    fireEvent.click(screen.getByRole("button", { name: "Sólo vencidas" }))
    const [url, options] = nav.replace.mock.calls.at(-1) ?? []
    const params = new URL(String(url), "http://localhost").searchParams
    expect(params.get("vista")).toBe("vencidas")
    expect(params.has("estado")).toBe(false)
    expect(params.get("faena")).toBe("ws-1")
    expect(options).toEqual({ scroll: false })
  })

  it("estado=overdue (enlace de antes) se lee como la vista de vencidas", () => {
    nav.params = new URLSearchParams("estado=overdue")
    renderPrograms([
      program({ id: "vencida", templateName: "Vencida de ayer", nextDueOn: "2020-01-01" }),
      program({ id: "al-dia", templateName: "Al día" }),
    ])
    const button = screen.getByRole("button", { name: "Ver todas" })
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(programTable().getByText("Vencida de ayer")).toBeTruthy()
    expect(programTable().queryByText("Al día")).toBeNull()

    // «Ver todas» limpia las dos formas de pedir lo mismo.
    fireEvent.click(button)
    const [url] = nav.replace.mock.calls.at(-1) ?? []
    expect(new URL(String(url), "http://localhost").search).toBe("")
  })

  it("el estado vacío ofrece la acción real que se le pasa", () => {
    renderPrograms([], { canManage: true, emptyAction: <button type="button">Nuevo programa</button> })
    expect(screen.getByText("Aún no hay programación")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Nuevo programa" })).toBeTruthy()
  })

  it("sin plantillas aprobadas el estado vacío lo dice y manda a Plantillas", () => {
    renderPrograms([], {
      canManage: true,
      emptyDescription: "Para programar necesitas al menos una plantilla aprobada.",
      emptyAction: <Link href="/prevencion/inspecciones/plantillas">Ir a Plantillas</Link>,
    })
    expect(screen.getByText("Para programar necesitas al menos una plantilla aprobada.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a Plantillas" }).getAttribute("href")).toBe("/prevencion/inspecciones/plantillas")
  })

  it("con filtros que no dejan nada, el vacío ofrece limpiarlos", () => {
    nav.params = new URLSearchParams("q=no-existe")
    renderPrograms([program()])
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    const [url] = nav.replace.mock.calls.at(-1) ?? []
    expect(new URL(String(url), "http://localhost").search).toBe("")
  })
})
