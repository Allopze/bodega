// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { DEFAULT_SCHEDULE_HORIZON } from "@/lib/services/pdtp/recurrence"
import { ApplyPresetDialog, describeScheduleBatchSkipReason } from "./apply-preset-dialog"

const { mockApply, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockApply: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({ applyPdtpSchedulePresetAction: mockApply }))
vi.mock("@/lib/toast", () => ({ toast: mockToast }))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: {
    children?: ReactNode
    value?: string
    onValueChange?: (value: string) => void
  }) => (
    <select data-testid="select" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value, disabled }: { children?: ReactNode; value: string; disabled?: boolean }) => (
    <option value={value} disabled={disabled}>{children}</option>
  ),
}))

const ACTIVITIES = [
  { id: "a", n: 1, activity: "Actividad A" },
  { id: "b", n: 2, activity: "Actividad B" },
]

/** El select de "Patrón" es siempre el primero en el DOM (el de "Actividades
 *  ya planificadas" va después, y los presets con parámetros agregan más
 *  selects entre medio) — con el mock nativo de `@/components/ui/select`,
 *  ninguno tiene un rol distinguible por sí solo. */
function presetSelect(): HTMLElement {
  return screen.getAllByTestId("select")[0]!
}

beforeEach(() => {
  mockApply.mockResolvedValue({ ok: true, data: { applied: ["a", "b"], skippedConflicts: [] } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("describeScheduleBatchSkipReason", () => {
  it("nunca devuelve el enum crudo, para los cuatro motivos del servicio", () => {
    const reasons = [
      "manual_schedule_would_be_replaced",
      "retired",
      "not_scheduled_mode",
      "preset_produced_no_cells",
    ] as const
    for (const reason of reasons) {
      const text = describeScheduleBatchSkipReason(reason)
      expect(text).not.toBe(reason)
      expect(text.length).toBeGreaterThan(5)
    }
    // El motivo de "sin celdas" explica el POR QUÉ (rango fuera del período),
    // no sólo que no se aplicó.
    expect(describeScheduleBatchSkipReason("preset_produced_no_cells")).toMatch(/período del programa/)
  })
})

describe("ApplyPresetDialog", () => {
  it("elegir 'Quincenal (S1/S3)' invoca la acción con los ids seleccionados y el preset elegido", async () => {
    const onOpenChange = vi.fn()
    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={onOpenChange}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    fireEvent.change(presetSelect(), { target: { value: "biweekly_13" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      programId: "prog-1",
      activityIds: ["a", "b"],
      preset: "biweekly_13",
      mode: "replace",
    }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    // Sin conflictos, el diálogo se cierra solo: no se queda esperando a que
    // el usuario cierre una pantalla de resultado que un `router.refresh()`
    // posterior podría hacer desaparecer sin que la vea (ver JSDoc del
    // componente).
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/2 actividades actualizada/))
  })

  it("con conflictos de planificación manual, muestra la lista con el número y motivo, y el botón 'Reemplazar manuales' — sin cerrar todavía", async () => {
    mockApply.mockResolvedValueOnce({
      ok: true,
      data: {
        applied: [],
        skippedConflicts: [{ activityId: "a", n: 1, reason: "manual_schedule_would_be_replaced" }],
      },
    })
    const onOpenChange = vi.fn()

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={onOpenChange}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    // El nombre de la actividad debe verse, no sólo su número: el usuario
    // decide qué reemplazar leyendo la actividad, no un id.
    expect(screen.getByRole("checkbox", { name: /N°1 — Actividad A — Tiene una planificación hecha a mano/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reemplazar manuales" })).toBeInTheDocument()
    // No se reenvía nada todavía: sigue habiendo una sola llamada, y el
    // diálogo sigue abierto esperando la decisión del usuario.
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it("al confirmar el reemplazo, reenvía SOLO los ids marcados, no la selección original ni un booleano", async () => {
    mockApply
      .mockResolvedValueOnce({
        ok: true,
        data: {
          applied: [],
          skippedConflicts: [
            { activityId: "a", n: 1, reason: "manual_schedule_would_be_replaced" },
            { activityId: "b", n: 2, reason: "manual_schedule_would_be_replaced" },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { applied: ["a"], skippedConflicts: [] } })

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={() => {}}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    // Destamarca la actividad B: el usuario decide reemplazar sólo la A.
    fireEvent.click(screen.getByRole("checkbox", { name: /N°2/ }))

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reemplazar manuales" }))
    })

    expect(mockApply).toHaveBeenCalledTimes(2)
    const [secondCall] = mockApply.mock.calls[1]!
    expect(secondCall.activityIds).toEqual(["a"])
    expect(secondCall.replaceConfirmedActivityIds).toEqual(["a"])
    expect(secondCall).not.toHaveProperty("replaceConfirmed")
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/1 actividad actualizada/))
  })

  it("mientras confirma el reemplazo, muestra carga de verdad (no vuelve a ver el formulario del preset)", async () => {
    let resolveSecondCall!: (value: unknown) => void
    mockApply
      .mockResolvedValueOnce({
        ok: true,
        data: {
          applied: [],
          skippedConflicts: [{ activityId: "a", n: 1, reason: "manual_schedule_would_be_replaced" }],
        },
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondCall = resolve }))

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={() => {}}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reemplazar manuales" }))
    })

    // Durante el viaje al servidor, la pantalla de conflicto se queda (no
    // reaparece el formulario del preset con "Cancelar" habilitado) y el
    // botón muestra carga de verdad: texto propio y `aria-busy`, no sólo
    // `disabled`.
    const loadingButton = screen.getByRole("button", { name: "Reemplazando…" })
    expect(loadingButton).toHaveAttribute("aria-busy", "true")
    expect(loadingButton).toBeDisabled()
    expect(screen.getByRole("button", { name: "No reemplazar" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: /N°1/ })).toBeDisabled()
    expect(screen.queryByLabelText("Patrón")).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondCall({ ok: true, data: { applied: ["a"], skippedConflicts: [] } })
    })

    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/1 actividad actualizada/))
  })

  it("'No reemplazar' cierra el flujo de conflicto, refresca y avisa sin reenviar nada", async () => {
    mockApply.mockResolvedValueOnce({
      ok: true,
      data: {
        applied: ["a"],
        skippedConflicts: [{ activityId: "b", n: 2, reason: "manual_schedule_would_be_replaced" }],
      },
    })
    const onOpenChange = vi.fn()

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={onOpenChange}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })
    expect(screen.getByRole("button", { name: "No reemplazar" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "No reemplazar" }))

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // La actividad B (no reemplazada) queda mencionada en el aviso, no sólo
    // silenciosamente descartada.
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/N°2.*hecha a mano/))
  })

  it("elegir 'Diario (n por semana)' muestra el campo de cantidad y lo envía en params", async () => {
    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={() => {}}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    fireEvent.change(presetSelect(), { target: { value: "daily" } })
    const quantityInput = screen.getByLabelText("Cantidad por semana")
    fireEvent.change(quantityInput, { target: { value: "3" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      preset: "daily",
      params: expect.objectContaining({ plannedQuantity: 3 }),
    }))
  })

  it("con omisiones informativas (sin conflicto que confirmar), avisa el detalle y cierra igual", async () => {
    mockApply.mockResolvedValueOnce({
      ok: true,
      data: {
        applied: ["a"],
        skippedConflicts: [{ activityId: "b", n: 2, reason: "retired" }],
      },
    })
    const onOpenChange = vi.fn()

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={onOpenChange}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/1 actividad actualizada.*N°2: Está retirada/))
  })

  it("muestra el mensaje de error del servidor sin cerrar el diálogo ni refrescar", async () => {
    mockApply.mockResolvedValueOnce({ ok: false, message: "El programa ya no admite cambios." })
    const onOpenChange = vi.fn()

    render(
      <ApplyPresetDialog
        programId="prog-1"
        open
        onOpenChange={onOpenChange}
        activities={ACTIVITIES}
        horizon={DEFAULT_SCHEDULE_HORIZON}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    })

    expect(screen.getByRole("alert")).toHaveTextContent("El programa ya no admite cambios.")
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
