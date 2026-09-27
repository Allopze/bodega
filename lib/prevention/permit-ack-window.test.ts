/**
 * PREV-M06 (T7a, D27): la ventana de acuse del AST se deriva de la tabla de
 * transiciones, no de una lista de estados copiada en cada llamador. Un estado
 * es terminal cuando ya no tiene salida; en él no se acusa. Sin TTL.
 */
import { describe, expect, it } from "vitest"
import { permitCrewAckWindow, PERMIT_STATUS_LABELS, PERMIT_TRANSITIONS } from "./permits"

describe("permitCrewAckWindow", () => {
  it("abre en todo estado con salida y cierra en los terminales", () => {
    for (const status of Object.keys(PERMIT_TRANSITIONS)) {
      const window = permitCrewAckWindow(status)
      expect(window.open, status).toBe(PERMIT_TRANSITIONS[status]!.length > 0)
    }
    expect(permitCrewAckWindow("closed")).toEqual({ open: false, reason: expect.stringMatching(/cerrado/i) })
    expect(permitCrewAckWindow("rejected").open).toBe(false)
    expect(permitCrewAckWindow("cancelled").open).toBe(false)
    expect(permitCrewAckWindow("suspended")).toEqual({ open: true, reason: null })
  })

  it("un estado desconocido no abre la ventana", () => {
    expect(permitCrewAckWindow("inventado").open).toBe(false)
  })

  it("cada estado terminal tiene rótulo para el motivo", () => {
    for (const [status, next] of Object.entries(PERMIT_TRANSITIONS)) {
      if (next.length === 0) expect(PERMIT_STATUS_LABELS[status]).toBeTruthy()
    }
  })
})
