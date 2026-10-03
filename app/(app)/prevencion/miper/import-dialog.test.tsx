// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider, useSafeShellHeader } from "@/components/layout/header-context"
import type { MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
import type { RiskImportPreview } from "@/lib/services/miper/import"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper", useSearchParams: () => new URLSearchParams() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))
const actions = vi.hoisted(() => ({ previewRiskImportAction: vi.fn(), commitRiskImportAction: vi.fn(), saveRiskFactorAction: vi.fn() }))
vi.mock("./actions", () => actions)

import { ImportMiperDialog } from "./import-dialog"

const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
    { rowNumber: 15, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "keyword" } },
  ],
  responsibles: [{ key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 4, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } }],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 2, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}

function previewRow(rowNumber: number, status: "ready" | "rejected") {
  return {
    rowNumber, status, original: {}, fingerprintSha256: "x", riskFactorId: "riskfactor-mecanico", riskFactorName: "Mecánico",
    issues: status === "rejected" ? [{ code: "p_out_of_scale", message: "La probabilidad 3 no está en la escala (1, 2 o 4)." }] : [],
    normalized: { activity: "Traslado de lodo", hazard: `Peligro de la fila ${rowNumber}`, risk: null, probability: 2, consequence: 4 },
    magnitude: status === "rejected" ? null : 8, classification: status === "rejected" ? null : "important",
  }
}

/** Lo que la vista previa devuelve: sólo los campos que pinta el diálogo. */
const preview = (batchId: string) => ({
  batchId, sheetName: "RE-04 IPER", target: "draft",
  rows: [previewRow(14, "ready"), previewRow(15, "ready"), previewRow(16, "rejected")],
  totals: { total: 3, ready: 2, needsReview: 0, rejected: 1 },
  draft: { period: 2026, blockedReason: null },
  live: { matrixId: null, title: null, blockedReason: "La faena no tiene una MIPER vigente a la que agregar las filas: cárgalas en un borrador." },
  measureAnalysis: ANALYSIS,
  responsibleOptions: [{ id: "u-1", name: "Jefe de faena" }],
}) as unknown as RiskImportPreview

const WORKSITES = [{ id: "ws-1", name: "Faena Norte", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false }]
const pasoActual = (dialog: HTMLElement) => dialog.querySelector('[aria-current="step"]')
/** Holgura para `test:fast`, que corre cientos de archivos en paralelo: 1 s (el valor por defecto) se queda corto bajo carga. */
const LENTO = { timeout: 5000 }

async function abrirYRevisar() {
  render(<ImportMiperDialog worksites={WORKSITES} currentYear={2026} canManageCatalog={false} />)
  fireEvent.click(screen.getByRole("button", { name: "Importar" }))
  const dialog = await screen.findByRole("dialog", { name: "Importar el RE-04" }, LENTO)
  fireEvent.change(within(dialog).getByLabelText("Archivo del RE-04"), { target: { files: [new File(["x"], "RE-04 Biodiversa.xlsx")] } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Revisar el archivo" }))
  await within(dialog).findByText("3 filas en «RE-04 IPER»: 2 para cargar, 0 por revisar y 1 sin cargar.", {}, LENTO)
  return dialog
}

afterEach(() => { vi.clearAllMocks() })

describe("ImportMiperDialog (Fase C)", () => {
  it("recorre Archivo → Filas → Medidas detectadas → Confirmar y envía los tres mapeos", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.commitRiskImportAction.mockResolvedValue({ ok: true, message: "2 riesgos cargados con 4 medidas propuestas (2 existentes y 2 por implementar); 1 fila detenida", data: { matrixId: "m-nueva" } })
    const dialog = await abrirYRevisar()
    expect(pasoActual(dialog)).toHaveTextContent("2. Filas")

    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    expect(pasoActual(dialog)).toHaveTextContent("3. Medidas detectadas")
    // No se avanza con tipos sin confirmar: el Excel no los trae y siempre los confirma una persona.
    expect(within(dialog).getByRole("button", { name: "Siguiente" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))

    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
    const resumen = within(dialog).getByRole("region", { name: "Qué se va a cargar" })
    expect(resumen).toHaveTextContent("2 riesgos listos para cargar.")
    expect(resumen).toHaveTextContent("1 fila no se carga: probabilidad o consecuencia fuera de 1, 2 y 4.")
    expect(resumen).toHaveTextContent("4 medidas: 2 existentes y 2 por implementar.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cargar en borrador" }))

    await waitFor(() => expect(actions.commitRiskImportAction).toHaveBeenCalledTimes(1), LENTO)
    expect(actions.commitRiskImportAction).toHaveBeenCalledWith({
      batchId: "riskimport-1", worksiteId: "ws-1", target: "draft", period: 2026, revisionReason: "Importación RE-04 desde RE-04 Biodiversa.xlsx",
      measureMapping: { "orden limpieza": "administrative", "topes descarga": "engineering", "uso epp casco guantes calzado seguridad": "ppe" },
      responsibleMapping: { "supervisor/prevencion": { kind: "text", name: "SUPERVISOR/PREVENCION" } },
      deadlineMapping: { "inmediato / antes de continuar la tarea": { kind: "pending", dueDate: "2026-10-03" }, trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m-nueva"), LENTO)
    expect(toast.success).toHaveBeenCalledWith("2 riesgos cargados con 4 medidas propuestas (2 existentes y 2 por implementar); 1 fila detenida")
  })

  it("volver a revisar el archivo descarta las decisiones: valen las del lote nuevo (Review Focus 1)", async () => {
    actions.previewRiskImportAction.mockResolvedValueOnce({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.previewRiskImportAction.mockResolvedValueOnce({ ok: true, data: { preview: preview("riskimport-2") } })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Atrás" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Atrás" }))
    expect(pasoActual(dialog)).toHaveTextContent("1. Archivo")
    fireEvent.change(within(dialog).getByLabelText("Período del borrador"), { target: { value: "2027" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Revisar el archivo" }))
    await within(dialog).findByText("3 filas en «RE-04 IPER»: 2 para cargar, 0 por revisar y 1 sin cargar.", {}, LENTO)
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    // Las sugerencias aceptadas eran del lote 1: en el lote 2 vuelven a estar por confirmar.
    expect(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Siguiente" })).toBeDisabled()
  })

  it("un rechazo del servidor queda a la vista y el diálogo no se cierra", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.commitRiskImportAction.mockResolvedValue({ ok: false, message: "La importación no coincide con la vista previa: falta decidir el tipo de 1 medida. Vuelve a revisar el archivo." })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cargar en borrador" }))
    expect(await within(dialog).findByRole("alert", {}, LENTO)).toHaveTextContent("falta decidir el tipo de 1 medida")
    expect(router.push).not.toHaveBeenCalled()
    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
  })

  it("un archivo sin medidas salta «Medidas detectadas»", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: { ...preview("riskimport-1"), measureAnalysis: { measures: [], phrases: [], responsibles: [], deadlines: [] } } } })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
    expect(within(dialog).getByRole("region", { name: "Qué se va a cargar" })).toHaveTextContent("El archivo no trae medidas de control.")
  })

  it("volver a «Archivo» conserva el archivo elegido: el campo no se vacía mientras se cambia el período", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Atrás" }))
    expect(pasoActual(dialog)).toHaveTextContent("1. Archivo")
    expect((within(dialog).getByLabelText("Archivo del RE-04") as HTMLInputElement).files?.[0]?.name).toBe("RE-04 Biodiversa.xlsx")
  })

  it("«Agregar al vigente» envía ese destino y es ese botón el que queda ocupado mientras carga", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: { ...preview("riskimport-1"), live: { matrixId: "m-vigente", title: "MIPER 2026", blockedReason: null } } } })
    let terminar: (value: unknown) => void = () => {}
    actions.commitRiskImportAction.mockReturnValue(new Promise((resolve) => { terminar = resolve }))
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Agregar al vigente" }))
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Agregar al vigente" })).toHaveAttribute("aria-busy", "true"), LENTO)
    expect(within(dialog).getByRole("button", { name: "Cargar en borrador" })).toHaveAttribute("aria-busy", "false")
    expect(actions.commitRiskImportAction).toHaveBeenCalledWith(expect.objectContaining({ target: "live", batchId: "riskimport-1" }))
    terminar({ ok: true, message: "2 riesgos cargados", data: { matrixId: "m-vigente" } })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m-vigente"), LENTO)
  })

  it("el buscador del TopBar no filtra a escondidas las filas de la vista previa (el diálogo lo tapa)", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    render(
      <ShellHeaderProvider>
        <TopBarSearch />
        <ImportMiperDialog worksites={WORKSITES} currentYear={2026} canManageCatalog={false} />
      </ShellHeaderProvider>,
    )
    // Quien buscó una faena en la portada y después abre «Importar».
    fireEvent.change(screen.getByLabelText("Filtrar en esta página"), { target: { value: "Faena Norte" } })
    fireEvent.click(screen.getByRole("button", { name: "Importar" }))
    const dialog = await screen.findByRole("dialog", { name: "Importar el RE-04" }, LENTO)
    fireEvent.change(within(dialog).getByLabelText("Archivo del RE-04"), { target: { files: [new File(["x"], "RE-04 Biodiversa.xlsx")] } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Revisar el archivo" }))
    await within(dialog).findByText("3 filas en «RE-04 IPER»: 2 para cargar, 0 por revisar y 1 sin cargar.", {}, LENTO)
    for (const fila of [14, 15, 16]) expect(within(dialog).getByRole("cell", { name: `Peligro de la fila ${fila}` })).toBeTruthy()
  })
})

/** El buscador del TopBar, reducido a lo que importa aquí: escribe en el `searchQuery` de la shell. */
function TopBarSearch() {
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  return <input aria-label="Filtrar en esta página" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
}
