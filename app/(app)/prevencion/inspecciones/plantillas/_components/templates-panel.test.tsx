// @vitest-environment jsdom

import type { ComponentProps } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TemplatePreviewPayload } from "@/lib/prevention/inspection-template-preview"
import type { ImportableDefinition, TemplateItem } from "../../_components/catalog-types"
import { ImportTemplateDialog } from "./import-template-dialog"
import { InspectionTemplatesPanel } from "./templates-panel"

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
  importInspectionTemplateAction: vi.fn(),
  linkInspectionTemplateSourceAction: vi.fn(),
  remindTemplateApprovalAction: vi.fn(),
  rollbackInspectionTemplateAction: vi.fn(),
  setInspectionTemplateParityAction: vi.fn(),
  setInspectionTemplatePdtpActivitiesAction: vi.fn(),
  promoteUnclassifiedDeviationAction: vi.fn(),
  setTemplateDeviationAction: vi.fn(),
}))
vi.mock("../../actions", () => actions)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

const fetchMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
  nav.params = new URLSearchParams()
  nav.replace.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

/** Abre «Más acciones de …» (Radix abre el menú con el pointerdown, no con el clic). */
function openMenu(name = "Inspección de Contenedores") {
  fireEvent.pointerDown(table().getByRole("button", { name: `Más acciones de ${name}` }), { button: 0, ctrlKey: false })
  return screen.getByRole("menu")
}

/** Elige un ítem del menú abierto. */
function chooseItem(name: string | RegExp) {
  fireEvent.click(screen.getByRole("menuitem", { name }))
}

/** El nombre de cada fila de la tabla, sin el encabezado. */
const bodyRows = () => table().getAllByRole("row").slice(1)

const officialDraft = (over: Partial<TemplateItem> = {}) => template({
  provenanceKind: "official_document",
  needsOfficialSource: true,
  officialChecksumSha256: "abc",
  parityReport: { status: "pending", differences: [] },
  ...over,
})
describe("plantillas: estado y acciones que el servidor rechazaría", () => {
  it("una plantilla retirada se llama «Retirada» y una reemplazada «Reemplazada»", () => {
    // Las versiones fuera de uso sólo se listan con el filtro: la tabla muestra una fila por instrumento vigente.
    nav.params = new URLSearchParams("estado=superseded")
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
    openMenu()
    chooseItem("Revertir a v2-reemplazada")
    expect(screen.getByRole("dialog").textContent).toContain("Volver a v2-reemplazada")
  })

  it("sin una versión que la actual haya reemplazado no hay nada a qué volver", () => {
    renderTemplates([
      template({ id: "vigente", versionLabel: "v3", status: "approved" }),
      template({ id: "retirada", versionLabel: "v1-retirada", status: "superseded", supersededByTemplateId: null }),
    ])
    openMenu()
    expect(screen.queryByRole("menuitem", { name: /^Revertir/ })).toBeNull()
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
    expect(within(openMenu()).getByRole("menuitem", { name: /^Desviaciones/ })).toBeTruthy()
    expect(table().getByText("Ninguna ofrecida")).toBeTruthy()
  })

  it("quien no administra no ve la columna de desviaciones ni la acción, aunque el instrumento las registre", () => {
    renderTemplates([template({ recordsDeviations: true })], { canManage: false })
    expect(table().queryByRole("columnheader", { name: "Desviaciones" })).toBeNull()
    expect(table().queryByRole("button", { name: /Desviaciones/ })).toBeNull()
    expect(table().queryByText("Ninguna ofrecida")).toBeNull()
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
    openMenu()
    chooseItem(/^Desviaciones/)
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
    // Corto en la fila («N° 29»); el nombre de la actividad está en el tooltip y en el nombre accesible.
    expect(table().getByRole("button", { name: "Acredita N° 29 — Inspección de contenedores" }).textContent).toBe("N° 29")
    expect(table().getByText("al aprobarse")).toBeTruthy()
  })

  it("la acreditación del eje de revisión se muestra aparte", () => {
    renderTemplates([template({
      status: "approved",
      pdtpAccreditation: { source: "catalog", executeSource: "catalog", reviewSource: "catalog", execute: ["N° 25 — Ejecutar"], review: ["N° 26 — Revisar"] },
    })])
    expect(table().getByRole("button", { name: "Acredita N° 25 — Ejecutar" }).textContent).toBe("N° 25")
    expect(table().getByText(/Al revisar:/)).toBeTruthy()
    expect(table().getByRole("button", { name: "N° 26" })).toBeTruthy()
  })

  it("el diálogo avisa que acredita por número y que un número sin actividad dejará de acreditar", () => {
    renderTemplates([template()])
    openMenu()
    chooseItem("Acreditación PDTP")
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
    openMenu()
    chooseItem("Acreditación PDTP")
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
    openMenu()
    chooseItem("Retirar…")
    const dialog = screen.getByRole("dialog")
    fireEvent.change(dialog.querySelector('textarea[name="reason"]')!, { target: { value: reason } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirar plantilla" }))
    return dialog
  }

  it("explica la consecuencia, pide un motivo con su pista y ofrece «Cancelar»", () => {
    renderTemplates([approved()])
    openMenu()
    chooseItem("Retirar…")
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

    openMenu()
    chooseItem("Retirar…")
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

describe("plantillas: una fila por instrumento", () => {
  const trio = () => [
    template({ id: "c-v4", versionLabel: "v4-borrador", status: "draft" }),
    template({ id: "c-v3", versionLabel: "v3", status: "approved" }),
    template({ id: "c-v2", versionLabel: "v2", status: "superseded", supersededByTemplateId: "c-v3" }),
    template({ id: "c-v1", versionLabel: "v1", status: "superseded", supersededByTemplateId: "c-v2" }),
  ]

  it("la versión aprobada es la fila y las reemplazadas no aparecen en la tabla", () => {
    renderTemplates(trio())
    expect(bodyRows()).toHaveLength(2)
    expect(table().getByText("v3")).toBeTruthy()
    expect(table().queryByText("v2")).toBeNull()
    expect(table().queryByText("v1")).toBeNull()
  })

  it("el borrador nuevo convive como subfila «Nueva versión en borrador», con su propio estado y su propio menú", () => {
    renderTemplates(trio())
    const [primary, sub] = bodyRows()
    expect(within(primary!).getByText("Aprobada")).toBeTruthy()
    expect(within(sub!).getByText("Nueva versión en borrador")).toBeTruthy()
    expect(within(sub!).getByText("Borrador")).toBeTruthy()
    // Dos filas del mismo instrumento: el menú de la subfila dice de cuál versión es.
    expect(within(primary!).getByRole("button", { name: "Más acciones de Inspección de Contenedores" })).toBeTruthy()
    expect(within(sub!).getByRole("button", { name: "Más acciones de Inspección de Contenedores v4-borrador" })).toBeTruthy()
  })

  it("avisa que hay versiones fuera de la tabla y ofrece listarlas", () => {
    renderTemplates(trio())
    expect(screen.getByText(/2 versiones reemplazadas o retiradas no se listan/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver reemplazadas o retiradas" }))
    const [url] = nav.replace.mock.calls.at(-1) ?? []
    expect(new URL(String(url), "http://localhost").searchParams.get("estado")).toBe("superseded")
  })

  it("con ?estado=superseded la lista es plana: cada versión reemplazada o retirada es una fila", () => {
    nav.params = new URLSearchParams("estado=superseded")
    renderTemplates(trio())
    expect(bodyRows()).toHaveLength(2)
    expect(table().getByText("v2")).toBeTruthy()
    expect(table().getByText("v1")).toBeTruthy()
    expect(table().queryByText("Nueva versión en borrador")).toBeNull()
    // Ya no hay nada oculto que avisar.
    expect(screen.queryByText(/no se listan/)).toBeNull()
  })

  it("la opción del filtro se llama «Reemplazadas o retiradas» y el chip activo lo dice", () => {
    nav.params = new URLSearchParams("estado=superseded")
    renderTemplates(trio())
    expect(screen.getByText("Reemplazadas o retiradas", { selector: "span.font-medium" })).toBeTruthy()
  })

  it("el contrato de la URL sigue siendo q, tipo y estado", () => {
    nav.params = new URLSearchParams("q=contenedores&tipo=inspection&estado=approved")
    renderTemplates([...trio(), template({ id: "o", code: "otra", name: "Observación de otra cosa", kind: "observation", status: "approved" })])
    expect(bodyRows()).toHaveLength(1)
    // Los tres filtros activos son chips removibles; quitar uno sólo suelta ese parámetro.
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Tipo" }))
    const [url] = nav.replace.mock.calls.at(-1) ?? []
    const params = new URL(String(url), "http://localhost").searchParams
    expect(params.has("tipo")).toBe(false)
    expect(params.get("q")).toBe("contenedores")
    expect(params.get("estado")).toBe("approved")
  })

  it("un instrumento que sólo tiene versiones retiradas lo dice y ofrece verlas", () => {
    renderTemplates([template({ id: "x", status: "superseded" })])
    expect(screen.getByText("No hay instrumentos vigentes ni borradores")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver reemplazadas o retiradas" }))
    expect(nav.replace).toHaveBeenCalled()
  })

  it("sin plantillas muestra la acción que las crea, no una ruta pegada como texto", () => {
    renderTemplates([], { emptyAction: <button type="button">Incorporar borrador</button> })
    expect(screen.getByText("No hay instrumentos incorporados")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Incorporar borrador" })).toBeTruthy()
  })

  it("con filtros que no dejan nada, el vacío ofrece limpiarlos", () => {
    nav.params = new URLSearchParams("q=no-existe")
    renderTemplates([template({ status: "approved" })])
    expect(screen.getByText("No hay plantillas con estos filtros")).toBeTruthy()
    // El vacío y la barra ofrecen «Limpiar filtros»; los dos limpian lo mismo.
    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!)
    const [url] = nav.replace.mock.calls.at(-1) ?? []
    expect(new URL(String(url), "http://localhost").search).toBe("")
  })
})

describe("plantillas: la acción de la fila es el siguiente paso, y el resto va en «Más acciones»", () => {
  it("«Acción» está siempre en la tabla y la fila trae su menú rotulado con el instrumento", () => {
    renderTemplates([template({ status: "approved" })])
    expect(table().getByRole("columnheader", { name: "Acción" })).toBeTruthy()
    expect(table().getByRole("button", { name: "Más acciones de Inspección de Contenedores" })).toBeTruthy()
  })

  it("sólo «Gravedad» y «Desviaciones» se ocultan bajo xl; «Estado», «Acredita PDTP» y «Acción» nunca", () => {
    renderTemplates([template({ status: "approved" })])
    const headers = table().getAllByRole("columnheader")
    const hiddenBelowXl = headers.filter((header) => header.className.includes("hidden xl:table-cell")).map((header) => header.textContent)
    expect(hiddenBelowXl.map((text) => text?.replace(/\s+/g, " ").trim())).toEqual(["Gravedad", "Desviaciones"])
    for (const name of ["Instrumento", "Estado", "Acredita PDTP", "Acción"]) {
      const header = headers.find((candidate) => candidate.textContent?.includes(name))
      expect(header, name).toBeTruthy()
      expect(header!.className).not.toContain("hidden")
    }
  })

  it("quien no administra no ve la columna «Desviaciones»", () => {
    renderTemplates([template({ status: "approved" })], { canManage: false })
    expect(table().queryByRole("columnheader", { name: "Desviaciones" })).toBeNull()
  })

  it("el menú de una aprobada ofrece ver el cuestionario, la acreditación, y «Retirar…» aparte y en rojo", () => {
    renderTemplates([template({ status: "approved" })])
    const menu = within(openMenu())
    const items = menu.getAllByRole("menuitem").map((item) => item.textContent)
    expect(items).toEqual(["Ver cuestionario", "Acreditación PDTP", "Retirar…"])
    expect(menu.getByRole("separator")).toBeTruthy()
    expect(menu.getByRole("menuitem", { name: "Retirar…" }).className).toContain("danger-ink")
  })

  it("con instrumento que registra desviaciones el menú trae «Desviaciones (n)» con las por clasificar", () => {
    renderTemplates([template({
      status: "approved",
      recordsDeviations: true,
      unclassifiedDeviations: [{ description: "Sin señalética", criticality: "high", occurrences: 2 }],
    })])
    expect(within(openMenu()).getByRole("menuitem", { name: "Desviaciones (1)" })).toBeTruthy()
  })

  it("un anexo oficial sin planilla: «Vincular fuente» es la acción visible y no se repite en el menú", () => {
    renderTemplates([officialDraft()], { documentSources: [source("v1", "abc")] })
    expect(table().getByRole("button", { name: "Vincular fuente" })).toBeTruthy()
    const items = within(openMenu()).getAllByRole("menuitem").map((item) => item.textContent)
    expect(items).not.toContain("Vincular fuente")
    expect(items).not.toContain("Aprobar")
  })

  it("con la paridad lista, «Aprobar» es la acción y declarar la paridad otra vez o cambiar la fuente van al menú", () => {
    renderTemplates([officialDraft({ sourceDocumentVersionId: "v1", parityReport: { status: "passed", differences: [] } })])
    expect(table().getByRole("button", { name: "Aprobar" })).toBeTruthy()
    const items = within(openMenu()).getAllByRole("menuitem").map((item) => item.textContent)
    expect(items).toEqual(expect.arrayContaining(["Declarar paridad", "Cambiar fuente", "Retirar…"]))
  })

  it("quien administra pero no aprueba tiene «Solicitar aprobación» como acción y avisa a quien sí puede", async () => {
    actions.remindTemplateApprovalAction.mockResolvedValue({ ok: true, data: { notified: ["Ana Pérez"] } })
    renderTemplates([template({ status: "draft" })], { canApprove: false })
    fireEvent.click(table().getByRole("button", { name: "Solicitar aprobación" }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Solicitud enviada a Ana Pérez."))
    expect(actions.remindTemplateApprovalAction).toHaveBeenCalledWith({ templateId: "t1" })
  })

  it("si avisar falla, el motivo queda como alerta junto a la fila", async () => {
    actions.remindTemplateApprovalAction.mockResolvedValue({ ok: false, message: "No hay nadie con permiso para aprobar." })
    renderTemplates([template({ status: "draft" })], { canApprove: false })
    fireEvent.click(table().getByRole("button", { name: "Solicitar aprobación" }))
    expect((await table().findByRole("alert")).textContent).toBe("No hay nadie con permiso para aprobar.")
  })

  it("quien sólo mira no tiene menú: «Ver cuestionario» es el botón", () => {
    renderTemplates([template({ status: "approved" })], { canManage: false, canApprove: false })
    expect(table().queryByRole("button", { name: /^Más acciones/ })).toBeNull()
    expect(table().getByRole("button", { name: "Ver cuestionario" })).toBeTruthy()
  })

  it("un diálogo se abre desde el menú (que ya no existe cuando el diálogo está abierto) y se cierra con «Cancelar»", async () => {
    renderTemplates([template({ status: "approved" })])
    openMenu()
    chooseItem("Acreditación PDTP")
    const dialog = screen.getByRole("dialog", { name: /Acreditación PDTP/ })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("plantillas: tarjetas móviles", () => {
  /** Las tarjetas son el `article` de cada fila; conviven con la tabla en el DOM. */
  const cards = () => screen.getAllByRole("article")

  it("una tarjeta por versión visible, con el borrador nuevo como su propia tarjeta", () => {
    renderTemplates([
      template({ id: "c-v4", versionLabel: "v4-borrador", status: "draft" }),
      template({ id: "c-v3", versionLabel: "v3", status: "approved" }),
      template({ id: "c-v2", versionLabel: "v2", status: "superseded", supersededByTemplateId: "c-v3" }),
    ])
    expect(cards()).toHaveLength(2)
    expect(within(cards()[1]!).getByText("Nueva versión en borrador")).toBeTruthy()
  })

  it("dice lo corto en la tarjeta («N° 25 +1») y el nombre en una línea: sin hover no hay tooltip, y la prosa no fija la altura", () => {
    renderTemplates([template({
      status: "approved",
      pdtpAccreditation: { source: "catalog", executeSource: "catalog", reviewSource: "catalog", execute: ["N° 25 — Ejecutar", "N° 27 — Otra"], review: ["N° 26 — Revisar"] },
    })])
    const card = within(cards()[0]!)
    expect(card.getByText("N° 25 +1")).toBeTruthy()
    expect(card.getByText("Ejecutar").className).toContain("truncate")
    expect(card.getByText(/Al revisar:/).textContent).toBe("Al revisar: N° 26")
    expect(card.queryByRole("button", { name: /^Acredita/ })).toBeNull()
  })

  it("una definición de plataforma sin novedades no lleva el campo «Fuente y paridad» vacío", () => {
    renderTemplates([template({ status: "approved" })])
    expect(within(cards()[0]!).queryByText("Fuente y paridad")).toBeNull()
  })

  it("un anexo oficial sí lo lleva, con su paridad y lo que falta", () => {
    renderTemplates([officialDraft()])
    const card = within(cards()[0]!)
    expect(card.getByText("Fuente y paridad")).toBeTruthy()
    expect(card.getByText("Falta vincular la planilla oficial.")).toBeTruthy()
  })

  it("la acción es el siguiente paso y «Más» abre el menú de acciones del instrumento", () => {
    renderTemplates([officialDraft()])
    const card = within(cards()[0]!)
    expect(card.getByRole("button", { name: "Vincular fuente" })).toBeTruthy()
    fireEvent.pointerDown(card.getByRole("button", { name: "Más acciones de Inspección de Contenedores" }), { button: 0, ctrlKey: false })
    expect(screen.getByRole("menuitem", { name: "Ver cuestionario" })).toBeTruthy()
  })

  it("el nombre abre la vista previa", () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    renderTemplates([template({ status: "approved" })])
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Inspección de Contenedores" }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("plantillas: vista previa del cuestionario", () => {
  const payload = (over: Partial<TemplatePreviewPayload> = {}): TemplatePreviewPayload => ({
    template: {
      id: "t1", code: "inspeccion_contenedores", versionLabel: "v1", name: "Inspección de Contenedores", kind: "inspection",
      status: "draft", statusLabel: "Borrador", createdAt: "2026-10-01T12:00:00.000Z", approvedAt: null, supersededAt: null,
    },
    questionnaire: {
      title: "Inspección de Contenedores",
      subtitle: null,
      objective: "Verificar el estado de los contenedores.",
      applicableTo: null,
      sections: [{
        id: "s1", title: "Estructura", description: null, countsForCompliance: true,
        items: [
          {
            id: "i1", label: "Puertas y bisagras", scale: [{ result: "conforming", label: "Bueno" }, { result: "partial", label: "Regular" }, { result: "non_conforming", label: "Malo" }],
            dataKindLabel: null, options: [], placeholder: null, required: false, effectiveRequired: true, scored: true,
            danoPotencial: "fatal", danoPotencialLabel: "Fatal", matrix: null,
          },
          {
            id: "i2", label: "N° de serie", scale: [], dataKindLabel: "Texto corto", options: [], placeholder: null,
            required: false, effectiveRequired: false, scored: false, danoPotencial: null, danoPotencialLabel: null, matrix: null,
          },
        ],
      }],
      totals: { sections: 1, items: 2, effectiveRequired: 1, scored: 1, withDanoPotencial: 1, dataItems: 1 },
      closingAct: {
        title: "Cierre de la inspección",
        resultOptions: [{ value: "ok", label: "Conforme" }, { value: "no", label: "No conforme" }],
        hasRestrictions: true,
        signatureRoles: [{ role: "jefe_area", label: "Jefe area" }, { role: "supervisor", label: "Supervisor" }],
      },
      recordsDeviations: false,
      recordsPreventiveActions: false,
      closesOnCompletion: false,
      rowsFromWarehouse: false,
    },
    versions: [
      { id: "t1", versionLabel: "v1", status: "draft", statusLabel: "Borrador", createdAt: "2026-10-01T12:00:00.000Z", approvedAt: null, supersededAt: null, current: true },
      { id: "t0", versionLabel: "v0", status: "superseded", statusLabel: "Retirada", createdAt: "2026-06-01T12:00:00.000Z", approvedAt: "2026-06-02T12:00:00.000Z", supersededAt: "2026-09-01T12:00:00.000Z", current: false },
    ],
    technical: {
      code: "inspeccion_contenedores",
      sourceDefinitionCode: "inspeccion_contenedores",
      provenanceLabel: "Documento oficial",
      source: { documentId: "doc-1", versionId: "docv-1", fileName: "anexo-14.xlsx", revision: "Rev. 02", checksumSha256: "a".repeat(64) },
      contentHash: "b".repeat(64),
      parity: { status: "failed", expectedItems: 30, actualItems: 28, differences: ["Falta el ítem «Pasador»"], verifiedAt: null },
    },
    ...over,
  })

  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

  it("al abrir pide el cuestionario a la ruta, con esqueleto mientras llega, y lo muestra completo", async () => {
    fetchMock.mockResolvedValue(respond(payload()))
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))

    const sheet = screen.getByRole("dialog", { name: "Inspección de Contenedores" })
    expect(within(sheet).getByRole("status", { name: "Cargando el cuestionario" })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/prevencion/inspecciones/plantillas/t1/vista-previa")
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal), cache: "no-store" })

    expect(await within(sheet).findByText("Puertas y bisagras")).toBeTruthy()
    // La escala del anexo, la gravedad y lo que el cierre exige.
    expect(within(sheet).getByText("Bueno · Regular · Malo")).toBeTruthy()
    expect(within(sheet).getByText("Fatal")).toBeTruthy()
    expect(within(sheet).getByText("Obligatorio")).toBeTruthy()
    expect(within(sheet).getByText("Texto corto")).toBeTruthy()
    // El acta y los roles con su etiqueta legible.
    expect(within(sheet).getByText("Cierre de la inspección")).toBeTruthy()
    expect(within(sheet).getByText("Jefe area · Supervisor")).toBeTruthy()
    expect(within(sheet).queryByRole("status", { name: "Cargando el cuestionario" })).toBeNull()
  })

  it("el detalle técnico viene plegado y trae el hash, la planilla y las diferencias de la paridad", async () => {
    fetchMock.mockResolvedValue(respond(payload()))
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))
    const sheet = screen.getByRole("dialog", { name: "Inspección de Contenedores" })
    await within(sheet).findByText("Puertas y bisagras")

    const details = within(sheet).getByText("Detalle técnico").closest("details")!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain("b".repeat(64))
    expect(details.textContent).toContain("a".repeat(64))
    expect(details.textContent).toContain("anexo-14.xlsx")
    expect(details.textContent).toContain("Falta el ítem «Pasador»")
    // Los hashes no están en la tabla (la hoja la oculta a los lectores, de ahí `hidden`).
    const rows = within(screen.getByRole("table", { hidden: true }))
    expect(rows.queryByText(/SHA-256/)).toBeNull()
    expect(rows.queryByText(/JSON/)).toBeNull()
  })

  it("el historial lista las versiones del instrumento, con «Retirada», y permite leer otra", async () => {
    fetchMock.mockResolvedValueOnce(respond(payload()))
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))
    const sheet = screen.getByRole("dialog", { name: "Inspección de Contenedores" })
    await within(sheet).findByText("Puertas y bisagras")

    const history = within(sheet).getByText("Versiones de este instrumento (2)").closest("details")!
    expect(within(history).getByText("Retirada")).toBeTruthy()
    expect(within(history).getByText("Estás viendo esta")).toBeTruthy()

    fetchMock.mockResolvedValueOnce(respond(payload({
      template: { ...payload().template, id: "t0", versionLabel: "v0", status: "superseded", statusLabel: "Retirada" },
    })))
    fireEvent.click(within(history).getByRole("button", { name: "Ver la versión v0" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/prevencion/inspecciones/plantillas/t0/vista-previa")
  })

  it("las prendas de EPP salen de la bodega y la hoja lo avisa", async () => {
    const base = payload()
    fetchMock.mockResolvedValue(respond({ ...base, questionnaire: { ...base.questionnaire, rowsFromWarehouse: true } }))
    renderTemplates([template({ code: "inspeccion_epp", name: "Inspección de EPP" })])
    fireEvent.click(table().getByRole("button", { name: "Inspección de EPP", exact: true }))
    const sheet = screen.getByRole("dialog", { name: "Inspección de EPP" })
    expect(await within(sheet).findByText("Las prendas se arman con la bodega de la faena al crear la inspección; aquí ves solo las filas fijas.")).toBeTruthy()
  })

  it("si falla, dice qué pasó como alerta y «Reintentar» vuelve a pedirlo", async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: "No se pudo cargar el cuestionario." }, 500))
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))
    const sheet = screen.getByRole("dialog", { name: "Inspección de Contenedores" })
    const alert = await within(sheet).findByRole("alert")
    expect(alert.textContent).toContain("No se pudo cargar el cuestionario.")

    fetchMock.mockResolvedValueOnce(respond(payload()))
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }))
    expect(await within(sheet).findByText("Puertas y bisagras")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(within(sheet).queryByRole("alert")).toBeNull()
  })

  it("sin red también dice qué pasó y deja reintentar, sin tirar la pantalla", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))
    const sheet = screen.getByRole("dialog", { name: "Inspección de Contenedores" })
    expect((await within(sheet).findByRole("alert")).textContent).toContain("Revisa la conexión")
    expect(within(sheet).getByRole("button", { name: "Reintentar" })).toBeTruthy()
  })

  it("cerrar la hoja antes de que llegue la respuesta aborta la petición", async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise(() => {})
    })
    const { unmount } = renderTemplates([template()])
    fireEvent.click(table().getByRole("button", { name: "Inspección de Contenedores", exact: true }))
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("se abre también desde «Ver cuestionario» del menú", async () => {
    fetchMock.mockResolvedValue(respond(payload()))
    renderTemplates([template({ status: "approved" })])
    openMenu()
    chooseItem("Ver cuestionario")
    expect(await screen.findByText("Puertas y bisagras")).toBeTruthy()
  })

  it("desde el diálogo de aprobar se abre apilada y no cierra el diálogo", async () => {
    fetchMock.mockResolvedValue(respond(payload()))
    renderTemplates([template({ status: "draft" })])
    fireEvent.click(table().getByRole("button", { name: "Aprobar" }))
    const approve = screen.getByRole("dialog", { name: /Aprobar Inspección de Contenedores/ })
    fireEvent.click(within(approve).getByRole("button", { name: "Ver el cuestionario" }))

    expect(await screen.findByText("Puertas y bisagras")).toBeTruthy()
    // El diálogo sigue abierto debajo (Radix lo oculta a los lectores mientras la hoja está encima).
    const dialogs = screen.getAllByRole("dialog", { hidden: true })
    expect(dialogs).toHaveLength(2)
    expect(dialogs.some((dialog) => dialog.textContent?.includes("Aprobar Inspección de Contenedores"))).toBe(true)
    expect(actions.approveInspectionTemplateAction).not.toHaveBeenCalled()
  })

  it("y desde el de paridad también", async () => {
    fetchMock.mockResolvedValue(respond(payload()))
    renderTemplates([officialDraft({ sourceDocumentVersionId: "v1" })])
    fireEvent.click(table().getByRole("button", { name: "Declarar paridad" }))
    const parity = screen.getByRole("dialog", { name: /Paridad de/ })
    fireEvent.click(within(parity).getByRole("button", { name: "Ver el cuestionario" }))
    expect(await screen.findByText("Puertas y bisagras")).toBeTruthy()
  })
})
