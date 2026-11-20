import { describe, expect, it } from "vitest"
import { faenaGuideNotice, pickFaenaGuide, type OrderGuide } from "./faena-guide"

const guide = (id: string, status: string, receiptId: string | null = `rec-${id}`): OrderGuide =>
  ({ id, code: `GDI-${id}`, status, receiptId })

const ALL = { viewGuides: true, receiveGuide: true, dispatchGuide: true, viewReceipts: true }
const NONE = { viewGuides: false, receiveGuide: false, dispatchGuide: false, viewReceipts: false }

describe("pickFaenaGuide", () => {
  it("prefiere la guía por confirmar, después el borrador, después la última cerrada", () => {
    expect(pickFaenaGuide([guide("1", "received"), guide("2", "draft"), guide("3", "partially_received")])?.id).toBe("3")
    expect(pickFaenaGuide([guide("1", "received"), guide("2", "draft")])?.id).toBe("2")
    expect(pickFaenaGuide([guide("1", "received"), guide("2", "received")])?.id).toBe("2")
  })

  it("una guía anulada no cuenta", () => {
    expect(pickFaenaGuide([guide("1", "cancelled")])).toBeNull()
    expect(pickFaenaGuide([])).toBeNull()
  })
})

describe("faenaGuideNotice", () => {
  it("con la guía despachada manda a confirmarla, con el verbo de la bandeja", () => {
    expect(faenaGuideNotice(guide("74", "dispatched"), "Santa Fe", ALL)).toEqual({
      title: "La recepción en faena se confirma en la guía GDI-74",
      description: "La oficina despachó esta OC a Santa Fe con la guía GDI-74. Ahí se marca lo que llegó y, si falta algo, el motivo.",
      action: { href: "/bodega/guias/74", label: "Confirmar llegada a faena" },
    })
  })

  it("con llegada parcial explica que lo que falta va en la misma guía", () => {
    const notice = faenaGuideNotice(guide("74", "partially_received"), "Santa Fe", ALL)
    expect(notice.description).toBe("La guía GDI-74 ya tiene una llegada parcial a Santa Fe. Lo que falta se confirma en la misma guía cuando llegue.")
    expect(notice.action?.label).toBe("Confirmar llegada a faena")
  })

  it("sin permiso para confirmar no promete la acción", () => {
    expect(faenaGuideNotice(guide("74", "dispatched"), "Santa Fe", { ...NONE, viewGuides: true }).action)
      .toEqual({ href: "/bodega/guias/74", label: "Ver la guía GDI-74" })
    const notice = faenaGuideNotice(guide("74", "dispatched"), "Santa Fe", NONE)
    expect(notice.action).toBeNull()
    expect(notice.description).toMatch(/La confirma quien recibe en faena\.$/)
  })

  it("un borrador es trabajo de oficina", () => {
    const notice = faenaGuideNotice(guide("9", "draft"), "Santa Fe", ALL)
    expect(notice.title).toBe("La guía GDI-9 todavía no sale de oficina")
    expect(notice.action).toEqual({ href: "/bodega/guias/9", label: "Completar despacho" })
    expect(faenaGuideNotice(guide("9", "draft"), "Santa Fe", { ...ALL, dispatchGuide: false }).action?.label).toBe("Ver la guía GDI-9")
  })

  it("con las guías cerradas lleva a la recepción en oficina para preparar otra", () => {
    expect(faenaGuideNotice(guide("5", "received", "rec-77"), "Santa Fe", ALL).action)
      .toEqual({ href: "/recepcion/rec-77", label: "Ver recepción en oficina" })
    expect(faenaGuideNotice(guide("5", "received", null), "Santa Fe", ALL).action).toBeNull()
  })
})
