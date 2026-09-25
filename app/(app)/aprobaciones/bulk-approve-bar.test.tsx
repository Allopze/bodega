// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(async () => ({ ok: true, message: "2 solicitudes aprobadas" })),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock("./actions", () => ({ bulkApproveRequestAction: mocks.approve }))
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }))

import { BulkApproveBar } from "./bulk-approve-bar"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BulkApproveBar", () => {
  /*
   * La barra sigue montada entre aprobaciones. La guarda que evita repetir el
   * aviso comparaba el texto del mensaje, así que dos aprobaciones seguidas con
   * el mismo texto dejaban la segunda sin aviso y con la selección puesta.
   */
  it("avisa y limpia la selección en dos aprobaciones seguidas con el mismo mensaje", async () => {
    const onClear = vi.fn()
    render(<BulkApproveBar selectedIds={["a", "b"]} onClear={onClear} />)

    fireEvent.click(screen.getByRole("button", { name: /Aprobar 2/ }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: /Aprobar 2/ }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(2))
    expect(mocks.toast.success).toHaveBeenCalledTimes(2)
  })

  it("no repite el aviso cuando solo cambia `onClear`", async () => {
    const first = vi.fn()
    const { rerender } = render(<BulkApproveBar selectedIds={["a", "b"]} onClear={first} />)
    fireEvent.click(screen.getByRole("button", { name: /Aprobar 2/ }))
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1))

    const second = vi.fn()
    rerender(<BulkApproveBar selectedIds={["a", "b"]} onClear={second} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(second).not.toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledTimes(1)
  })
})
