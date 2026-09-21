// @vitest-environment jsdom

/**
 * H-20: `IndicatorDenominatorDialog` es el modal realmente montado desde
 * `CanonicalIndicatorsDashboard` (a diferencia de `IndicadoresEditModal`,
 * huérfano — ver `indicadores-edit-modal.test.tsx`). Cubre la navegación
 * mensual, la protección de cambios sin guardar y "Guardar y continuar".
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { denominatorDialogLabel, IndicatorDenominatorDialog } from "./indicator-denominator-dialog"
import { saveSafetyIndicatorDenominatorAction } from "./actions"
import { toast } from "@/lib/toast"

vi.mock("./actions", () => ({
  saveSafetyIndicatorDenominatorAction: vi.fn(async () => ({ ok: true })),
  approveSafetyIndicatorDenominatorAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.mocked(saveSafetyIndicatorDenominatorAction).mockResolvedValue({ ok: true })
})

const BASE_PROPS = {
  worksiteId: "ws-1",
  year: 2026,
  month: 6,
  denominator: null,
  canManage: true,
  canApprove: false,
  currentUserId: "user-1",
}

const ROW = {
  id: "den-1",
  workerCount: 120,
  workedHours: 19_200,
  sourceType: "rrhh",
  sourceReference: "Nómina RR.HH. junio 2026",
  evidenceReference: "Folio 4471",
  evidenceChecksumSha256: null,
  status: "draft",
  reconciliationStatus: "matched",
  reconciliationNotes: null,
  version: 3,
  createdByUserId: "preparer",
  updatedByUserId: "preparer",
  updatedAt: "2026-07-02T14:30:00.000Z",
}

const ACCESS = { canManage: true, canApprove: true }

describe("denominatorDialogLabel", () => {
  it("propone Registrar sin registro, Gestionar con registro aprobado y Revisar en revisión", () => {
    expect(denominatorDialogLabel(null, ACCESS)).toBe("Registrar")
    expect(denominatorDialogLabel({ ...ROW, status: "approved" }, ACCESS)).toBe("Gestionar")
    expect(denominatorDialogLabel({ ...ROW, status: "pending_review" }, ACCESS)).toBe("Revisar")
  })

  it("no ofrece Revisar a quien no puede aprobar ni Gestionar a quien no puede editar", () => {
    const readOnly = { canManage: false, canApprove: false }
    expect(denominatorDialogLabel({ ...ROW, status: "pending_review" }, { canManage: true, canApprove: false })).toBe("Ver")
    expect(denominatorDialogLabel(ROW, readOnly)).toBe("Ver")
    expect(denominatorDialogLabel(null, readOnly)).toBe("Ver")
  })
})

describe("IndicatorDenominatorDialog — navegación mensual", () => {
  it("no muestra controles de navegación cuando no se pasa onNavigate", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Mes anterior" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).not.toBeInTheDocument()
  })

  it("navega de inmediato sin cambios pendientes", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    expect(onNavigate).toHaveBeenLastCalledWith(7)

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }))
    expect(onNavigate).toHaveBeenLastCalledWith(5)
  })

  it("deshabilita 'Mes anterior' en enero", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} month={1} onClose={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeDisabled()
  })

  it("deshabilita 'Mes siguiente' en diciembre", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} month={12} onClose={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled()
  })

  it("con cambios sin guardar, pide confirmación en vez de navegar de inmediato", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))

    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument()
  })

  it("'Descartar' navega sin guardar", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))

    expect(onNavigate).toHaveBeenCalledWith(7)
    expect(saveSafetyIndicatorDenominatorAction).not.toHaveBeenCalled()
  })

  it("'Guardar y continuar' guarda primero y luego navega", async () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }))

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith(7))
    expect(saveSafetyIndicatorDenominatorAction).toHaveBeenCalledTimes(1)
  })

  it("'Seguir editando' cierra la confirmación sin navegar", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }))

    expect(screen.queryByText(/Hay cambios sin guardar/)).not.toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  /** La guarda existía sólo para el cambio de mes; Esc/X descartaba en silencio. */
  it("cerrar con Escape y cambios sin guardar también pide confirmación", () => {
    const onClose = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={onClose} onNavigate={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/Hay cambios sin guardar.*antes de cerrar/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("cerrar sin cambios no interpone confirmación", () => {
    const onClose = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={onClose} />)

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("IndicatorDenominatorDialog — errores de validación", () => {
  it("pinta el error del servidor sobre el campo, no sólo en un toast", async () => {
    vi.mocked(saveSafetyIndicatorDenominatorAction).mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { reconciliationNotes: ["Explica por qué la conciliación sigue pendiente."] },
    })
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)

    fireEvent.submit(screen.getByRole("button", { name: "Guardar denominador" }).closest("form")!)

    expect(await screen.findByRole("alert")).toHaveTextContent("Explica por qué la conciliación sigue pendiente.")
    expect(screen.getByLabelText(/Notas/)).toHaveAttribute("aria-invalid", "true")
  })

  it("limpia el error del campo al corregirlo", async () => {
    vi.mocked(saveSafetyIndicatorDenominatorAction).mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { workerCount: ["Indica la dotación del mes."] },
    })
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)

    fireEvent.submit(screen.getByRole("button", { name: "Guardar denominador" }).closest("form")!)
    expect(await screen.findByText("Indica la dotación del mes.")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Dotación del mes/), { target: { value: "42" } })
    expect(screen.queryByText("Indica la dotación del mes.")).not.toBeInTheDocument()
  })

  it("no prellena la dotación ni las horas con 0 en un mes sin registro", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Dotación del mes/)).toHaveValue(null)
    expect(screen.getByLabelText(/Horas trabajadas/)).toHaveValue(null)
  })

  it("marca Notas como obligatorio salvo que la conciliación cuadre", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Notas/)).toBeRequired()

    render(<IndicatorDenominatorDialog {...BASE_PROPS} denominator={ROW} onClose={vi.fn()} />)
    expect(screen.getAllByLabelText(/Notas/).at(-1)).not.toBeRequired()
  })
})

describe("IndicatorDenominatorDialog — feedback y avisos", () => {
  it("distingue el guardado en borrador del envío a revisión", async () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} denominator={ROW} onClose={vi.fn()} />)

    fireEvent.submit(screen.getByRole("button", { name: "Guardar denominador" }).closest("form")!)
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Denominador guardado en borrador"))

    fireEvent.click(screen.getByLabelText("Enviar a revisión al guardar"))
    fireEvent.submit(screen.getByRole("button", { name: "Guardar denominador" }).closest("form")!)
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Denominador enviado a revisión"))
  })

  /** Guardar un aprobado reabre el período y revoca la acreditación PDTP. */
  it("advierte que corregir un aprobado revoca la acreditación PDTP", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} denominator={{ ...ROW, status: "approved" }} onClose={vi.fn()} />)
    expect(screen.getByRole("alert")).toHaveTextContent(/revoca la acreditación PDTP/i)
  })

  it("no muestra esa advertencia en un borrador", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} denominator={ROW} onClose={vi.fn()} />)
    expect(screen.queryByText(/revoca la acreditación PDTP/i)).not.toBeInTheDocument()
  })

  it("muestra el estado del registro en el encabezado", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} denominator={{ ...ROW, status: "approved" }} onClose={vi.fn()} />)
    expect(screen.getByText("Aprobado")).toBeInTheDocument()
  })

  it("los selects tienen nombre accesible", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)
    expect(screen.getByLabelText("Procedencia")).toBeInTheDocument()
    expect(screen.getByLabelText("Conciliación")).toBeInTheDocument()
  })
})

describe("IndicatorDenominatorDialog — el modal nunca queda vacío", () => {
  it("sin permiso de gestión y con registro en borrador, muestra el resumen en solo lectura", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} canManage={false} canApprove denominator={ROW} onClose={vi.fn()} />)

    expect(screen.queryByRole("button", { name: "Guardar denominador" })).not.toBeInTheDocument()
    expect(screen.getByText("Sólo lectura: editar el denominador exige el permiso de gestión de indicadores.")).toBeInTheDocument()
    expect(screen.getByText("120")).toBeInTheDocument()
  })

  it("sin permiso de gestión y sin registro, explica por qué no hay nada", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} canManage={false} canApprove onClose={vi.fn()} />)
    expect(screen.getByText("Sin denominador registrado")).toBeInTheDocument()
  })
})

describe("IndicatorDenominatorDialog — panel de aprobación", () => {
  const inReview = { ...ROW, status: "pending_review", reconciliationNotes: "Diferencia de 2 HH explicada" }

  it("muestra conciliación y notas, que antes quedaban ocultas al aprobador", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} canApprove denominator={inReview} currentUserId="approver" onClose={vi.fn()} />)

    expect(screen.getByText("Conciliación")).toBeInTheDocument()
    expect(screen.getByText("Cuadra con la fuente")).toBeInTheDocument()
    expect(screen.getByText("Diferencia de 2 HH explicada")).toBeInTheDocument()
    expect(screen.getByText("RR.HH.")).toBeInTheDocument()
  })

  it("explica cuántos caracteres faltan en vez de dejar los botones grises sin motivo", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} canApprove denominator={inReview} currentUserId="approver" onClose={vi.fn()} />)

    expect(screen.getByText("Faltan 10 caracteres para poder decidir.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Fundamento de decisión/), { target: { value: "Evidencia revisada y cuadrada" } })
    expect(screen.getByText("Fundamento suficiente para decidir.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled()
  })

  /** El servidor rechaza aprobar con conciliación pendiente; antes eso se
   *  descubría recién al apretar Aprobar, sin poder editar ni entender. */
  it("bloquea Aprobar con la conciliación pendiente y dice qué hacer", () => {
    const blocked = { ...inReview, reconciliationStatus: "pending" }
    render(<IndicatorDenominatorDialog {...BASE_PROPS} canApprove denominator={blocked} currentUserId="approver" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/Fundamento de decisión/), { target: { value: "Revisión completa del mes" } })

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeEnabled()
    expect(screen.getByRole("alert")).toHaveTextContent(/No se puede aprobar con la conciliación pendiente/)
  })

  it("distingue «lo preparaste tú» de «te falta permiso»", () => {
    const { unmount } = render(<IndicatorDenominatorDialog {...BASE_PROPS} canApprove denominator={inReview} currentUserId="preparer" onClose={vi.fn()} />)
    expect(screen.getByText(/No puedes aprobar un denominador que preparaste tú/)).toBeInTheDocument()
    unmount()

    render(<IndicatorDenominatorDialog {...BASE_PROPS} canApprove={false} denominator={inReview} currentUserId="otro" onClose={vi.fn()} />)
    expect(screen.getByText("La aprobación requiere un usuario con permiso de cierre.")).toBeInTheDocument()
  })
})
