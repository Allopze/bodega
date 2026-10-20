// @vitest-environment jsdom

/**
 * La captura de una inspección como la ve quien trabaja: una cabecera de
 * trabajo, un progreso que dice qué falta y lleva a ello, y los ítems en un solo
 * árbol con el resultado a un toque.
 *
 * Los ítems son puntuables a propósito (cumple / no cumple / no aplica): se
 * responden con el grupo de radio, no con el `Select` de Radix, que en jsdom no
 * abre su popover.
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const saveInspectionAnswersAction = vi.fn()
const otraAccion = () => vi.fn().mockResolvedValue({ ok: true })

vi.mock("../actions", () => ({
  saveInspectionAnswersAction,
  cancelInspectionRunAction: otraAccion(),
  closeInspectionFindingAction: otraAccion(),
  completeInspectionRunAction: otraAccion(),
  createFindingCapaAction: otraAccion(),
  registerDeviationAction: otraAccion(),
  registerInspectionPreventiveActionAction: otraAccion(),
  remindInspectionReviewAction: otraAccion(),
  removeAnswerEvidenceAction: otraAccion(),
  removeDeviationAction: otraAccion(),
  reopenInspectionRunAction: otraAccion(),
  reviewInspectionRunAction: otraAccion(),
  saveInspectionParticipantsAction: otraAccion(),
  stopVehicleForFindingAction: otraAccion(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

// Cuántas veces se pinta el grupo de resultado de cada ítem (el `React.memo` del ítem).
const groupRenders: Record<string, number> = {}
vi.mock("@/components/ui/choice-card-group", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/choice-card-group")>()
  return {
    ...original,
    ChoiceCardGroup: (props: React.ComponentProps<typeof original.ChoiceCardGroup>) => {
      const name = String(props.label)
      groupRenders[name] = (groupRenders[name] ?? 0) + 1
      return <original.ChoiceCardGroup {...props} />
    },
  }
})

// Cuántas copias del diálogo de cierre se montan (antes eran dos, cada una con su estado).
let completeDialogMounts = 0
vi.mock("./_components/complete-dialog", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_components/complete-dialog")>()
  return {
    ...original,
    CompleteDialog: (props: React.ComponentProps<typeof original.CompleteDialog>) => {
      React.useEffect(() => { completeDialogMounts += 1 }, [])
      return <original.CompleteDialog {...props} />
    },
  }
})

const { InspectionRunDetail } = await import("./inspection-run-detail")

type DetailProps = React.ComponentProps<typeof InspectionRunDetail>

const RUN_ID = "run-capture-layout"

const SCORABLE = { kind: "cumple_nocumple_na_obs" as const, required: false, countsForCompliance: true, danoPotencial: null }
const ITEM_A = { id: "a", label: "Casco", ...SCORABLE }
const ITEM_B = { id: "b", label: "Guantes", ...SCORABLE }
const ITEM_C = { id: "c", label: "Lentes", ...SCORABLE }
const CELDA_USO = {
  id: "zapato_uso", label: "Zapato: usa", kind: "si_no_na_obs" as const, required: false, countsForCompliance: true, danoPotencial: null,
  matrix: { rowId: "zapato", rowLabel: "Zapato", columnLabel: "Usa (Sí/No/N/A)" },
}
const CELDA_ESTADO = {
  id: "zapato_estado", label: "Zapato: estado", kind: "bueno_regular_malo_obs" as const, required: false, countsForCompliance: true, danoPotencial: null,
  matrix: { rowId: "zapato", rowLabel: "Zapato", columnLabel: "Estado (B/R/M)" },
}

function propsDelDetalle(overrides: Partial<DetailProps> = {}): DetailProps {
  return {
    run: {
      id: RUN_ID, code: "INS-CAPTURA-001", status: "in_progress", origin: "programada",
      subjectType: null, subjectLabel: "Trabajador QA", subjectResourceId: null, subjectVehicleId: null,
      scheduledFor: null, executedAt: null, reviewedAt: null, reviewComment: null,
      conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
      compliancePercent: null, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: null,
      executedByUserId: null, executorOfRecord: null, closingResult: null, closingRestrictions: null, closingSignatures: null,
      locationLatitude: null, locationLongitude: null, version: 1,
    },
    templateKind: "inspection",
    recordsDeviations: false,
    recordsPreventiveActions: false,
    deviationCatalog: [],
    pdtpActivityNumbers: [64],
    pdtpReviewActivityNumbers: [],
    worksiteName: "Faena de prueba",
    assigneeName: "Inspectora Uno",
    executorName: null,
    reviewerName: null,
    sections: [{ id: "sec-1", title: "Equipo", items: [ITEM_A, ITEM_B, ITEM_C] }],
    answers: [],
    findings: [],
    isUnplannedInspection: false,
    participants: [],
    currentUserId: "user-1",
    assignees: [],
    reviewers: [],
    canExecute: true,
    canReview: false,
    canManage: true,
    canRequestRecharge: false,
    canStopVehicle: false,
    documents: [],
    canIngest: false,
    closingAct: null,
    physicalSourceRequired: false,
    ...overrides,
  }
}

async function montar(overrides: Partial<DetailProps> = {}) {
  const view = render(<InspectionRunDetail {...propsDelDetalle(overrides)} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return view
}

async function dejarCorrerElDebounce(ms = 1_500) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function grupo(item: string) {
  return screen.getByRole("radiogroup", { name: `Resultado de ${item}` })
}

function elegir(item: string, resultado: string) {
  fireEvent.click(within(grupo(item)).getByRole("radio", { name: resultado }))
}

let scrollIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  saveInspectionAnswersAction.mockReset()
  saveInspectionAnswersAction.mockImplementation(
    () => new Promise((resolve) => { setTimeout(() => resolve({ ok: true, data: { version: 2, answerRefs: [] } }), 50) }),
  )
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const key of Object.keys(groupRenders)) delete groupRenders[key]
  completeDialogMounts = 0
  // jsdom no calcula el diseño: sin esto `jumpToItem` no encuentra nada «pintado» ni sabe desplazar.
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent
})

describe("el resultado se elige a un toque", () => {
  it("por clic: queda elegido y el autoguardado lo envía", async () => {
    await montar()
    elegir("Casco", "Cumple")

    expect(within(grupo("Casco")).getByRole("radio", { name: "Cumple" })).toBeChecked()
    await dejarCorrerElDebounce()
    expect(saveInspectionAnswersAction).toHaveBeenCalledTimes(1)
    expect(saveInspectionAnswersAction.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 1,
      answers: [{ itemId: "a", result: "conforming" }],
    })
  })

  it("por teclado: la flecha mueve la elección al siguiente resultado", async () => {
    await montar()
    elegir("Casco", "Cumple")

    fireEvent.keyDown(within(grupo("Casco")).getByRole("radio", { name: "Cumple" }), { key: "ArrowRight" })

    expect(within(grupo("Casco")).getByRole("radio", { name: "No cumple" })).toBeChecked()
    expect(document.activeElement).toBe(within(grupo("Casco")).getByRole("radio", { name: "No cumple" }))
  })

  it("hay UN solo árbol: cada ítem aparece una vez (antes tarjeta y tabla a la vez)", async () => {
    await montar()
    expect(screen.getAllByRole("radiogroup", { name: "Resultado de Casco" })).toHaveLength(1)
    expect(screen.getAllByLabelText("Comentario de Casco", { exact: false })).toHaveLength(1)
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("la zona de motivo", () => {
  it("se abre sola al elegir «No cumple», lo dice en el resumen y no roba el foco", async () => {
    await montar()
    const cumple = within(grupo("Casco")).getByRole("radio", { name: "Cumple" })
    fireEvent.click(cumple)
    cumple.focus()

    elegir("Casco", "No cumple")

    const comentario = screen.getByLabelText("Comentario de Casco")
    expect(comentario.closest("details")).toHaveProperty("open", true)
    expect(within(comentario.closest("details")!).getByText("Motivo obligatorio")).toBeInTheDocument()
    expect(document.activeElement).not.toBe(comentario)
  })

  it("«Guardar» no se deshabilita por una fila con problemas, en la cabecera ni en la barra", async () => {
    await montar()
    elegir("Casco", "No cumple")
    await dejarCorrerElDebounce()

    expect(screen.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled()
    // La fila mala no se envía, y lo demás sigue guardándose.
    expect(saveInspectionAnswersAction).not.toHaveBeenCalled()
    expect(screen.getByRole("group", { name: "Acciones de la inspección en el teléfono" })).toHaveTextContent("Guardado, salvo 1 respuesta incompleta")
  })
})

describe("el progreso reemplaza al muro de bloqueos", () => {
  it("dice cuántos obligatorios lleva, sin «· N totales»", async () => {
    await montar()
    expect(screen.getByText("0 de 3 obligatorios")).toBeInTheDocument()
    elegir("Casco", "Cumple")
    expect(screen.getByText("1 de 3 obligatorios")).toBeInTheDocument()
    expect(screen.queryByText(/totales/)).toBeNull()
    expect(screen.getByRole("progressbar", { name: "Avance: 1 de 3 obligatorios" })).toHaveAttribute("aria-valuenow", "1")
  })

  it("no pinta el muro «Para declarar ejecutada falta:» fuera del diálogo", async () => {
    await montar()
    expect(screen.queryByText("Para declarar ejecutada falta:")).toBeNull()
  })

  it("«3 sin responder» salta al primer ítem sin responder y lo enfoca", async () => {
    await montar()
    elegir("Casco", "Cumple")

    fireEvent.click(screen.getByRole("button", { name: "2 sin responder" }))

    expect(scrollIntoView).toHaveBeenCalled()
    const primero = scrollIntoView.mock.contexts.at(-1) as HTMLElement
    expect(primero.id).toBe("item-sec-1::b")
    expect(document.activeElement).toBe(within(grupo("Guantes")).getAllByRole("radio")[0])
  })

  it("«sin motivo» lleva al comentario del ítem", async () => {
    await montar()
    elegir("Lentes", "No cumple")

    fireEvent.click(screen.getByRole("button", { name: "1 sin motivo" }))

    expect(document.activeElement).toBe(screen.getByLabelText("Comentario de Lentes"))
  })

  it("«acta incompleta» salta al acta de cierre", async () => {
    await montar({
      closingAct: { title: "Acta de cierre", resultOptions: [{ value: "apto", label: "Apto" }], hasRestrictions: false, signatureRoles: [] },
    })

    fireEvent.click(screen.getByRole("button", { name: "acta incompleta" }))

    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).id).toBe("acta-cierre")
  })

  it("«Ver lista (n)» despliega la lista completa sin scroll propio y cada línea lleva a su ítem", async () => {
    await montar()
    const toggle = screen.getByRole("button", { name: "Ver lista (3)" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const lista = document.getElementById(toggle.getAttribute("aria-controls")!)!
    expect(within(lista).getAllByRole("button")).toHaveLength(3)
    // Un scroll dentro del scroll de la página era justo lo que había (`max-h-56 overflow-y-auto`).
    expect(lista.className).not.toMatch(/overflow|max-h/)

    fireEvent.click(within(lista).getByRole("button", { name: /Lentes/ }))
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).id).toBe("item-sec-1::c")
  })

  it("con todo respondido dice que está lista para declarar", async () => {
    await montar()
    elegir("Casco", "Cumple")
    elegir("Guantes", "Cumple")
    elegir("Lentes", "Cumple")

    expect(screen.getByText("Lista para declarar ejecutada")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Ver lista/ })).toBeNull()
  })
})

describe("la cabecera de trabajo", () => {
  it("es UNA tarjeta con faena, sujeto, responsable y UN solo badge de estado", async () => {
    await montar()
    const cabecera = screen.getByRole("region", { name: "Resumen de la inspección" })
    expect(within(cabecera).getByText("Faena de prueba · Trabajador QA")).toBeInTheDocument()
    expect(within(cabecera).getByText("Responsable: Inspectora Uno")).toBeInTheDocument()
    expect(screen.getAllByText("En ejecución")).toHaveLength(1)
    expect(screen.queryByText("Trabajo actual")).toBeNull()
  })

  it("el resto de los datos queda plegado en «Ver más datos»; «Origen» y la etiqueta PDTP con su explicación", async () => {
    await montar()
    const pliegue = screen.getByText("Ver más datos").closest("details")!
    expect(pliegue.open).toBe(false)
    expect(within(pliegue).getByText("Origen")).toBeInTheDocument()
    expect(within(pliegue).getByText("N° 64 al ejecutar")).toBeInTheDocument()
    // La sigla se explica con un Tooltip enfocable.
    const sigla = within(pliegue).getByText("PDTP")
    expect(sigla).toHaveAttribute("tabindex", "0")
    await act(async () => {
      sigla.focus()
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByRole("tooltip")).toHaveTextContent("Programa de trabajo preventivo")
  })

  it("«Capturar ubicación» vive en el pliegue", async () => {
    await montar()
    const pliegue = screen.getByText("Ver más datos").closest("details")!
    expect(within(pliegue).getByRole("button", { name: "Capturar ubicación" })).toBeInTheDocument()
  })

  it("el cumplimiento no se muestra mientras se edita, y sí una vez declarada ejecutada", async () => {
    const { unmount } = await montar()
    expect(screen.queryByText("Resultado oficial")).toBeNull()
    expect(screen.queryByText("Resultado normalizado")).toBeNull()
    expect(screen.queryByText("Aún no calculable")).toBeNull()
    unmount()

    await montar({ run: { ...propsDelDetalle().run, status: "completed", executedAt: "2026-10-19T12:00:00Z", normalizedComplianceBasisPoints: 10000 }, executorName: "Inspectora Uno" })
    expect(screen.getAllByText("Resultado normalizado").length).toBeGreaterThan(0)
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0)
  })
})

describe("las acciones del registro ya no están en el contenido", () => {
  it("ni en captura ni en lectura: viven en el encabezado de la página (RunRecordActions)", async () => {
    const captura = await montar({ canReview: true, canManage: true })
    for (const nombre of ["Acta PDF", "Reabrir para rectificar", "Cancelar inspección"]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull()
      expect(screen.queryByRole("link", { name: nombre })).toBeNull()
    }
    captura.unmount()

    await montar({ canReview: true, canManage: true, canExecute: false, run: { ...propsDelDetalle().run, status: "completed", executedAt: "2026-10-19T12:00:00Z" } })
    for (const nombre of ["Acta PDF", "Reabrir para rectificar", "Cancelar inspección"]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull()
      expect(screen.queryByRole("link", { name: nombre })).toBeNull()
    }
  })
})

describe("«Declarar ejecutada»: un solo diálogo para los dos botones", () => {
  it("se monta una vez y lo abren por igual el botón de la cabecera y el de la barra del teléfono", async () => {
    await montar()
    expect(completeDialogMounts).toBe(1)

    const [desdeCabecera, desdeBarra] = screen.getAllByRole("button", { name: "Declarar ejecutada" })
    fireEvent.click(desdeCabecera!)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(desdeBarra!)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: /Declarar ejecutada INS-CAPTURA-001/ })).toBeInTheDocument()
    expect(completeDialogMounts).toBe(1)
  })

  it("el diálogo lista lo que falta con «Ir al primero»", async () => {
    await montar()
    fireEvent.click(screen.getAllByRole("button", { name: "Declarar ejecutada" })[0]!)
    const dialogo = screen.getByRole("dialog")
    expect(within(dialogo).getByText("Para declarar ejecutada falta:")).toBeInTheDocument()
    expect(within(dialogo).getByRole("button", { name: "Ir al primero" })).toBeInTheDocument()
    expect(within(dialogo).getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
  })

  /**
   * R-01 (reauditoría 2026-10-20): con todo respondido y el resultado del acta sin
   * elegir, el diálogo decía «no corresponde a las opciones de la plantilla» y no
   * llevaba a ningún lado. Ahora dice qué falta y salta al acta, como los chips.
   */
  it("con solo el resultado del acta sin elegir, lo dice y lleva al acta", async () => {
    await montar({
      closingAct: { title: "Acta de cierre", resultOptions: [{ value: "apto", label: "Apto" }], hasRestrictions: false, signatureRoles: [] },
    })
    elegir("Casco", "Cumple")
    elegir("Guantes", "Cumple")
    elegir("Lentes", "Cumple")

    fireEvent.click(screen.getAllByRole("button", { name: "Declarar ejecutada" })[0]!)
    const dialogo = screen.getByRole("dialog")
    expect(within(dialogo).getByText(/Falta elegir el resultado del acta de cierre "Acta de cierre"\./)).toBeInTheDocument()
    expect(within(dialogo).queryByText(/no corresponde a las opciones/)).toBeNull()
    expect(within(dialogo).getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    // No hay ítem al que ir: el único atajo es el del acta.
    expect(within(dialogo).queryByRole("button", { name: "Ir al primero" })).toBeNull()

    scrollIntoView.mockClear()
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ir al acta" }))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    expect(screen.queryByRole("dialog")).toBeNull()
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).id).toBe("acta-cierre")
  })

  it("el diálogo dice «crea un hallazgo», no «materializa»", async () => {
    await montar()
    fireEvent.click(screen.getAllByRole("button", { name: "Declarar ejecutada" })[0]!)
    const dialogo = screen.getByRole("dialog")
    expect(within(dialogo).getByText(/crea un hallazgo por cada incumplimiento/)).toBeInTheDocument()
    expect(within(dialogo).queryByText(/materializa/i)).toBeNull()
  })
})

describe("la matriz de EPP", () => {
  it("una prenda tiene DOS grupos de radio (Usa y Estado) y no dos ítems sueltos", async () => {
    await montar({ sections: [{ id: "sec-1", title: "Uso y estado de EPP", items: [CELDA_USO, CELDA_ESTADO] }] })

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 3, name: "1. Zapato" })).toBeInTheDocument()
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2)
    expect(grupo("Zapato: usa")).toBeInTheDocument()
    expect(grupo("Zapato: estado")).toBeInTheDocument()
    elegir("Zapato: estado", "Malo")
    expect(screen.getByText("Motivo obligatorio")).toBeInTheDocument()
  })
})

describe("los títulos de sección y los chips", () => {
  const DOS_SECCIONES = [
    { id: "s1", title: "Equipo", items: [ITEM_A, ITEM_B] },
    { id: "s2", title: "Entorno", items: [ITEM_C] },
  ]

  it("cada sección es un h2 con su lugar en la secuencia y cuánto lleva", async () => {
    await montar({ sections: DOS_SECCIONES })
    elegir("Casco", "Cumple")

    expect(screen.getByRole("heading", { level: 2, name: "Equipo" })).toBeInTheDocument()
    expect(screen.getByText("Sección 1 de 2 · 1 de 2")).toBeInTheDocument()
    expect(screen.getByText("Sección 2 de 2 · 0 de 1")).toBeInTheDocument()
  })

  it("los chips de la navegación llevan «3/12» y miden 44 px en el teléfono", async () => {
    await montar({ sections: DOS_SECCIONES })
    elegir("Casco", "Cumple")

    const nav = screen.getByRole("navigation", { name: "Secciones de la inspección" })
    const chip = within(nav).getByRole("link", { name: /1\. Equipo/ })
    expect(chip).toHaveTextContent("1/2")
    expect(chip.className).toContain("min-h-11")
    expect(within(nav).getByRole("link", { name: /2\. Entorno/ })).toHaveTextContent("0/1")
  })

  it("con una sola sección no hay rótulo de secuencia ni chips", async () => {
    await montar()
    expect(screen.queryByText(/Sección 1 de 1/)).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Secciones de la inspección" })).toBeNull()
  })
})

describe("React.memo del ítem", () => {
  it("teclear en el comentario de un ítem no repinta el grupo de los demás", async () => {
    await montar()
    elegir("Casco", "No cumple")
    const antes = { guantes: groupRenders["Resultado de Guantes"]!, lentes: groupRenders["Resultado de Lentes"]! }

    const comentario = screen.getByLabelText("Comentario de Casco")
    fireEvent.change(comentario, { target: { value: "Golpe" } })
    fireEvent.change(comentario, { target: { value: "Golpe fuerte" } })
    fireEvent.change(comentario, { target: { value: "Golpe fuerte en la visera" } })

    // Los otros ítems conservan las mismas props y callbacks estables: no se repintan.
    expect(groupRenders["Resultado de Guantes"]).toBe(antes.guantes)
    expect(groupRenders["Resultado de Lentes"]).toBe(antes.lentes)
  })
})
