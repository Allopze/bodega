import { describe, expect, it } from "vitest"
import { movementDocumentHref, referenceTypeLabel } from "@/app/(app)/bodega/movement-href"

describe("movementDocumentHref", () => {
  it("resuelve los documentos que sí tienen pantalla", () => {
    expect(movementDocumentHref("receipt", "rec-1")).toBe("/recepcion/rec-1")
    expect(movementDocumentHref("delivery", "del-1")).toBe("/entregas/del-1/print")
    expect(movementDocumentHref("dispatch_guide", "gdi-1")).toBe("/bodega/guias/gdi-1")
  })

  it("manda los papeles de bodega a su propia lista", () => {
    expect(movementDocumentHref("stock_adjustment", "aju-1")).toBe("/bodega/documentos?doc=aju-1")
    expect(movementDocumentHref("delivery_return", "dev-1")).toBe("/bodega/documentos?doc=dev-1")
    expect(movementDocumentHref("physical_inventory_count", "con-1")).toBe("/bodega/documentos?doc=con-1")
  })

  it("no le inventa destino al cierre de faena: es un evento del audit_log", () => {
    expect(movementDocumentHref("worksite_closure", "ws-1")).toBeNull()
  })

  it("devuelve null cuando falta el tipo, el id o el tipo es desconocido", () => {
    expect(movementDocumentHref(null, "x")).toBeNull()
    expect(movementDocumentHref("receipt", null)).toBeNull()
    expect(movementDocumentHref("receipt", "")).toBeNull()
    expect(movementDocumentHref("algo_nuevo", "x")).toBeNull()
  })
})

describe("referenceTypeLabel", () => {
  it("rotula en español los tipos conocidos", () => {
    expect(referenceTypeLabel("dispatch_guide")).toBe("Guía de despacho")
    expect(referenceTypeLabel("physical_inventory_count")).toBe("Conteo físico")
  })

  it("degrada un tipo desconocido a texto legible en vez de pintar el enum crudo", () => {
    expect(referenceTypeLabel("algo_nuevo_raro")).toBe("algo nuevo raro")
  })

  it("sin tipo no hay etiqueta", () => {
    expect(referenceTypeLabel(null)).toBeNull()
    expect(referenceTypeLabel(undefined)).toBeNull()
  })
})
