// @vitest-environment jsdom

/**
 * El modo lectura y revisión de una inspección: el resumen primero, después los
 * hallazgos (tarjetas bajo `md`, tabla desde `md`), después lo que no cumple, y lo
 * conforme plegado por sección. Sin columnas vacías ni textos de edición, con los
 * valores por su etiqueta y con un solo diálogo de revisión.
 *
 * jsdom no aplica CSS: tarjetas y tabla están las dos en el DOM, y los tests lo
 * tienen en cuenta (`getAllByRole`) en vez de depender de qué árbol se ve.
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const otraAccion = () => vi.fn().mockResolvedValue({ ok: true })

vi.mock("../actions", () => ({
  saveInspectionAnswersAction: otraAccion(),
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

// Cuántas copias del diálogo de revisión se montan (antes eran dos, cada una con su estado).
let reviewDialogMounts = 0
vi.mock("./_components/review-dialog", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_components/review-dialog")>()
  return {
    ...original,
    ReviewDialog: (props: React.ComponentProps<typeof original.ReviewDialog>) => {
      React.useEffect(() => { reviewDialogMounts += 1 }, [])
      return <original.ReviewDialog {...props} />
    },
  }
})

const { InspectionRunDetail } = await import("./inspection-run-detail")

type DetailProps = React.ComponentProps<typeof InspectionRunDetail>

const RUN_ID = "run-lectura"
const SCORABLE = { kind: "cumple_nocumple_na_obs" as const, required: false, countsForCompliance: true, danoPotencial: null }
const ITEM_CASCO = { id: "casco", label: "Casco", ...SCORABLE }
const ITEM_GUANTES = { id: "guantes", label: "Guantes", ...SCORABLE }
const ITEM_FRENOS = { id: "frenos", label: "Frenos", ...SCORABLE }
const ITEM_LUCES = { id: "luces", label: "Luces", ...SCORABLE }
const ITEM_AGENTE = {
  id: "agente", label: "Tipo de agente", kind: "select" as const, required: false, countsForCompliance: false, danoPotencial: null,
  options: [{ value: "pqs", label: "PQS (Polvo Químico Seco)" }],
}

function respuesta(itemId: string, sectionId: string, result: string, extra: Partial<DetailProps["answers"][number]> = {}) {
  return { answerId: `ans-${itemId}`, sectionId, itemId, result, comment: null, value: null, evidence: [], needsConfirmation: false, ...extra }
}

function hallazgo(id: string, extra: Partial<DetailProps["findings"][number]> = {}): DetailProps["findings"][number] {
  return {
    id, description: `Hallazgo ${id}`, criticality: "high", status: "open", capaActionId: null, origin: "derived",
    potentialDamageDescription: null, immediateMeasure: null, applicableLaw: null, evidence: [], ...extra,
  }
}

function propsDelDetalle(overrides: Partial<DetailProps> = {}): DetailProps {
  return {
    run: {
      id: RUN_ID, code: "INS-LECTURA-001", status: "completed", origin: "programada",
      subjectType: null, subjectLabel: "Camión KA122", subjectResourceId: null, subjectVehicleId: null,
      scheduledFor: null, executedAt: "2026-10-19T12:00:00.000Z", reviewedAt: null, reviewComment: null,
      conformingCount: 3, partialCount: 0, nonConformingCount: 1, notApplicableCount: 1,
      compliancePercent: 75, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: 7500,
      executedByUserId: "user-ejecutor", executorOfRecord: "platform_user",
      closingResult: null, closingRestrictions: null, closingSignatures: null,
      locationLatitude: null, locationLongitude: null, version: 4,
    },
    templateKind: "inspection",
    recordsDeviations: false,
    recordsPreventiveActions: false,
    deviationCatalog: [],
    pdtpActivityNumbers: [24],
    pdtpReviewActivityNumbers: [],
    worksiteName: "Faena de prueba",
    assigneeName: "Inspectora Uno",
    executorName: "Ejecutor Uno",
    reviewerName: null,
    sections: [
      { id: "equipo", title: "Equipo", items: [ITEM_CASCO, ITEM_GUANTES, ITEM_FRENOS, ITEM_LUCES] },
      { id: "datos", title: "Datos del extintor", items: [ITEM_AGENTE] },
      { id: "entorno", title: "Entorno", items: [{ id: "orden", label: "Orden", ...SCORABLE }, { id: "aseo", label: "Aseo", ...SCORABLE }] },
    ],
    answers: [
      respuesta("casco", "equipo", "conforming"),
      respuesta("guantes", "equipo", "conforming"),
      respuesta("frenos", "equipo", "non_conforming", { comment: "Pastillas gastadas" }),
      respuesta("luces", "equipo", "not_applicable", { comment: "Sin luces adicionales" }),
      respuesta("agente", "datos", "recorded", { value: "pqs" }),
      respuesta("orden", "entorno", "conforming"),
      respuesta("aseo", "entorno", "conforming"),
    ],
    findings: [
      hallazgo("h1", { description: "Frenos sin respuesta" }),
      hallazgo("h2", { description: "Rótulo borrado", criticality: "medium", status: "capa_linked", capaActionId: "capa-9" }),
    ],
    isUnplannedInspection: false,
    participants: [],
    currentUserId: "user-revisor",
    assignees: [{ id: "user-ana", name: "Ana Pérez" }],
    reviewers: [],
    canExecute: false,
    canReview: true,
    canManage: false,
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

/** `a` aparece antes que `b` en el documento. */
function antes(a: Element, b: Element) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
  reviewDialogMounts = 0
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("el orden de lectura: resumen, hallazgos, no conformidades, lo conforme plegado", () => {
  it("el resumen va antes que los hallazgos y éstos antes que las secciones", async () => {
    await montar()
    const resumen = screen.getByRole("region", { name: "Resumen de la inspección" })
    const hallazgos = screen.getByRole("heading", { level: 2, name: /Hallazgos \(2\)/ })
    const equipo = screen.getByRole("heading", { level: 2, name: "Equipo" })

    expect(antes(resumen, hallazgos)).toBe(true)
    expect(antes(hallazgos, equipo)).toBe(true)
  })

  it("el resumen dice resultado, conteos, hallazgos abiertos, quién ejecutó, y el estado UNA vez", async () => {
    await montar()
    const resumen = screen.getByRole("region", { name: "Resumen de la inspección" })

    expect(within(resumen).getByText("Resultado normalizado")).toBeInTheDocument()
    expect(within(resumen).getByText("75%")).toBeInTheDocument()
    expect(within(resumen).getByText("Cumple 3 · No cumple 1 · No aplica 1")).toBeInTheDocument()
    expect(within(resumen).getByRole("link", { name: "1 abierto de 2" })).toHaveAttribute("href", "#hallazgos")
    expect(within(resumen).getByText(/Ejecutor Uno/)).toBeInTheDocument()
    expect(screen.getAllByText("Pendiente de revisión")).toHaveLength(1)
  })

  it("una vez revisada, el resumen dice quién revisó y el comentario; no hay una frase suelta al final", async () => {
    await montar({
      reviewerName: "Revisora Dos",
      run: { ...propsDelDetalle().run, status: "reviewed", reviewedAt: "2026-10-20T12:00:00.000Z", reviewComment: "Todo conforme con la faena." },
    })
    const resumen = screen.getByRole("region", { name: "Resumen de la inspección" })
    expect(within(resumen).getByText(/Revisora Dos/)).toBeInTheDocument()
    expect(within(resumen).getByText("Todo conforme con la faena.")).toBeInTheDocument()
    expect(screen.queryByText(/^Revisada \d/)).toBeNull()
    expect(screen.getAllByText("Revisada y cerrada")).toHaveLength(1)
  })

  it("el contexto secundario va plegado, con un objetivo de 44 px en el teléfono", async () => {
    await montar()
    const pliegue = screen.getByText("Ver más datos")
    expect(pliegue.closest("details")).not.toHaveAttribute("open")
    expect(pliegue).toHaveClass("min-h-11")
    expect(screen.queryByText("Ver contexto completo")).toBeNull()
  })
})

describe("los hallazgos: tarjetas bajo md y tabla desde md", () => {
  it("hay una tarjeta por hallazgo con sus acciones, y la tabla con las mismas filas", async () => {
    await montar({ canExecute: true, canReview: true, canStopVehicle: false })
    const tarjetas = screen.getAllByRole("article")
    expect(tarjetas).toHaveLength(2)

    expect(within(tarjetas[0]!).getByText("Frenos sin respuesta")).toBeInTheDocument()
    expect(within(tarjetas[0]!).getByRole("button", { name: "Derivar a CAPA" })).toBeInTheDocument()
    expect(within(tarjetas[0]!).getByRole("button", { name: "Cerrar hallazgo" })).toBeInTheDocument()
    expect(within(tarjetas[1]!).getByRole("link", { name: "Ver CAPA" })).toHaveAttribute("href", "/prevencion/capa/capa-9")

    const tabla = screen.getByRole("region", { name: "Hallazgos de la inspección" })
    expect(within(tabla).getAllByRole("row")).toHaveLength(3)
    expect(within(tabla).getByRole("columnheader", { name: "Gravedad" })).toBeInTheDocument()
    expect(tabla).toHaveClass("hidden", "md:block")
    expect(tarjetas[0]!.closest("ul")).toHaveClass("md:hidden")
  })

  it("«Ver CAPA» es un botón de la misma talla que las demás acciones, no un enlace suelto", async () => {
    await montar()
    const [verCapa] = screen.getAllByRole("link", { name: "Ver CAPA" })
    expect(verCapa).toHaveClass("h-11")
  })

  it("los diálogos se montan una vez: derivar abre UN diálogo aunque haya dos árboles", async () => {
    await montar({ canExecute: true })
    expect(screen.getAllByRole("button", { name: "Derivar a CAPA" }).length).toBe(2)

    fireEvent.click(screen.getAllByRole("button", { name: "Derivar a CAPA" })[0]!)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Derivar hallazgo a CAPA" })).toBeInTheDocument()
  })

  it("cerrar un hallazgo abre un solo diálogo con su descripción y pide el motivo", async () => {
    await montar()
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar hallazgo" })[0]!)

    const dialogo = screen.getByRole("dialog", { name: "Cerrar hallazgo" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(within(dialogo).getByText("Frenos sin respuesta")).toBeInTheDocument()
    expect(within(dialogo).getByLabelText("Motivo")).toBeInTheDocument()
  })

  it("sin permiso no hay acciones ni columna «Acción»", async () => {
    await montar({ canReview: false, canExecute: false, findings: [hallazgo("h1")] })
    expect(screen.queryByRole("button", { name: "Derivar a CAPA" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Cerrar hallazgo" })).toBeNull()
    expect(screen.queryByRole("columnheader", { name: "Acción" })).toBeNull()
  })
})

describe("las secciones: lo que pide atención a la vista y lo conforme plegado", () => {
  it("lo que no cumple se lee con su motivo, fuera de todo pliegue", async () => {
    await montar()
    const frenos = screen.getByText("Frenos")
    expect(frenos.closest("details")).toBeNull()
    expect(screen.getByText("Pastillas gastadas")).toBeInTheDocument()
    expect(screen.getByText("No cumple")).toBeInTheDocument()
  })

  it("lo conforme se pliega por sección en «{Sección} · N conformes»", async () => {
    await montar()
    const pliegue = screen.getByText("Equipo · 2 conformes, 1 no aplica")
    const details = pliegue.closest("details")!
    expect(details).not.toHaveAttribute("open")
    expect(within(details).getByText("Casco")).toBeInTheDocument()
    expect(within(details).getByText("Sin luces adicionales")).toBeInTheDocument()
    // Los de atención no están dentro del pliegue.
    expect(within(details).queryByText("Frenos")).toBeNull()
  })

  it("una sección toda conforme es sólo el pliegue: sin título aparte ni lista", async () => {
    await montar()
    expect(screen.getByText("Entorno · 2 conformes").closest("details")).not.toBeNull()
    expect(screen.queryByRole("heading", { name: "Entorno" })).toBeNull()
    // Pero su ancla existe para los chips de sección.
    expect(document.getElementById("section-entorno")).not.toBeNull()
  })

  it("el pliegue mide 44 px en el teléfono", async () => {
    await montar()
    expect(screen.getByText("Entorno · 2 conformes").closest("summary")).toHaveClass("min-h-11")
  })

  it("un dato registrado se lee por su etiqueta y no por el valor almacenado", async () => {
    await montar()
    expect(screen.getByText("PQS (Polvo Químico Seco)")).toBeInTheDocument()
    expect(screen.queryByText("pqs")).toBeNull()
  })

  it("lo conforme con foto sale a la vista y la foto se ve", async () => {
    await montar({
      answers: propsDelDetalle().answers.map((answer) =>
        answer.itemId === "casco" ? { ...answer, evidence: [{ id: "ev-1", path: "storage/inspection-evidence/casco.jpg", caption: null }] } : answer),
    })
    const foto = screen.getByRole("link", { name: "Ver foto 1 de Casco" })
    expect(foto).toHaveAttribute("href", "/api/prevencion/inspecciones/evidence/casco.jpg")
    expect(foto.closest("details")).toBeNull()
    expect(screen.getByText("Equipo · 1 conforme, 1 no aplica")).toBeInTheDocument()
  })

  it("sin columna «Evidencia» vacía, sin «Opcional» ni textos de edición", async () => {
    await montar()
    expect(screen.queryByRole("columnheader", { name: "Evidencia" })).toBeNull()
    expect(screen.queryByText("Opcional")).toBeNull()
    expect(screen.queryByText(/La foto queda vinculada/)).toBeNull()
    expect(screen.queryByText(/Obligatorio/)).toBeNull()
    expect(screen.queryByRole("button", { name: /Adjuntar|Agregar fotos/ })).toBeNull()
    expect(screen.queryByText(/dato de apoyo opcional|No capturada · opcional/)).toBeNull()
    expect(screen.queryByText(/Sin comentario/)).toBeNull()
  })

  it("las dos celdas de una prenda de EPP se leen juntas bajo la prenda", async () => {
    const celda = (id: string, columnLabel: string, kind: "si_no_na_obs" | "bueno_regular_malo_obs") => ({
      id, label: `Zapato: ${columnLabel}`, kind, required: false, countsForCompliance: true, danoPotencial: null,
      matrix: { rowId: "zapato", rowLabel: "Zapato", columnLabel },
    })
    await montar({
      sections: [{ id: "epp", title: "Uso y estado de EPP", items: [celda("zapato_uso", "Usa (Sí/No/N/A)", "si_no_na_obs"), celda("zapato_estado", "Estado (B/R/M)", "bueno_regular_malo_obs")] }],
      answers: [
        respuesta("zapato_uso", "epp", "conforming"),
        respuesta("zapato_estado", "epp", "non_conforming", { comment: "Suela rota" }),
      ],
      findings: [],
    })
    const prenda = screen.getByText("Zapato").closest("li")!
    expect(within(prenda).getByText("Usa")).toBeInTheDocument()
    expect(within(prenda).getByText("Estado")).toBeInTheDocument()
    expect(within(prenda).getByText("Suela rota")).toBeInTheDocument()
    expect(screen.getAllByText("Zapato")).toHaveLength(1)
  })
})

describe("revisar y cerrar: un solo diálogo para los dos botones", () => {
  it("se monta una vez y lo abren por igual el botón de la cabecera y el de la barra del teléfono", async () => {
    await montar({ findings: [] })
    expect(reviewDialogMounts).toBe(1)

    const [desdeCabecera, desdeBarra] = screen.getAllByRole("button", { name: "Revisar y cerrar" })
    expect(desdeCabecera).toBeDefined()
    expect(desdeBarra).toBeDefined()

    fireEvent.click(desdeCabecera!)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(desdeBarra!)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Revisar y cerrar INS-LECTURA-001" })).toBeInTheDocument()
    expect(reviewDialogMounts).toBe(1)
  })

  it("el rótulo de los dos botones cuenta los bloqueos", async () => {
    await montar()
    // El hallazgo alto sin CAPA bloquea el cierre: lo dice el botón, sin abrir nada.
    expect(screen.getAllByRole("button", { name: "Revisar y cerrar · 1 bloqueo" })).toHaveLength(2)
  })

  it("quien ejecutó no ve el botón: ve el aviso de revisión bloqueada y «Recordar a quien revisa»", async () => {
    await montar({
      currentUserId: "user-ejecutor",
      reviewers: [{ id: "user-revisor", name: "Revisora Dos" }],
    })
    expect(screen.queryByRole("button", { name: /Revisar y cerrar/ })).toBeNull()
    expect(reviewDialogMounts).toBe(0)
    expect(screen.getByText(/Tú ejecutaste esta inspección/)).toBeInTheDocument()
    expect(screen.getByText(/Puede cerrarla: Revisora Dos/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Recordar a quien revisa" })).toBeInTheDocument()
  })
})

describe("acta de cierre y casos sin respuestas", () => {
  const ACTA = { title: "Cierre de la inspección", resultOptions: [{ value: "operativo", label: "Operativo" }], hasRestrictions: false, signatureRoles: ["prevencionista", "supervisor"] }

  it("el resumen enlaza al acta, que lista resultado y firmas (y la que falta)", async () => {
    await montar({
      closingAct: ACTA,
      run: {
        ...propsDelDetalle().run,
        closingResult: "operativo",
        closingSignatures: [{ role: "prevencionista", name: "Pía Soto", userId: null, signedAt: "2026-10-19T12:30:00.000Z" }],
      },
    })
    const resumen = screen.getByRole("region", { name: "Resumen de la inspección" })
    expect(within(resumen).getByRole("link", { name: "Operativo · 1 de 2 firmas" })).toHaveAttribute("href", "#acta-cierre")

    const acta = screen.getByRole("heading", { level: 2, name: "Cierre de la inspección" }).closest("section")!
    expect(within(acta).getByText(/Pía Soto/)).toBeInTheDocument()
    expect(within(acta).getByText("Supervisor")).toBeInTheDocument()
    expect(within(acta).getByText("Sin firma")).toBeInTheDocument()
  })

  it("una inspección cancelada no muestra acta ni listas de «sin responder»", async () => {
    await montar({
      closingAct: ACTA,
      answers: [],
      findings: [],
      run: { ...propsDelDetalle().run, status: "cancelled", executedAt: null, conformingCount: 0, nonConformingCount: 0, notApplicableCount: 0, normalizedComplianceBasisPoints: null },
      executorName: null,
    })
    expect(screen.queryByRole("heading", { name: "Cierre de la inspección" })).toBeNull()
    expect(screen.queryByText(/sin responder/)).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Secciones de la inspección" })).toBeNull()
    expect(screen.getByText("No tiene cumplimiento ni hallazgos.")).toBeInTheDocument()
  })

  it("una inspección sin hallazgos lo dice y no pinta tabla", async () => {
    await montar({ findings: [] })
    expect(screen.getByText("Sin hallazgos: todos los ítems evaluables cumplieron.")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Hallazgos de la inspección" })).toBeNull()
  })

  it("las acciones del registro no se repiten en el contenido", async () => {
    await montar({ canManage: true })
    for (const nombre of ["Acta PDF", "Reabrir para rectificar", "Cancelar inspección"]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull()
      expect(screen.queryByRole("link", { name: nombre })).toBeNull()
    }
  })
})
