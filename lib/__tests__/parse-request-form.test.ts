import { describe, it, expect } from "vitest"
import type { Session } from "next-auth"
import { parseRequestForm } from "@/app/(app)/solicitudes/actions-module/parse-request-form"

/**
 * El formulario mandaba `deliveryMode` desde siempre, pero esta función no lo
 * leía: el esquema lo defaulteaba y TODA solicitud nacía 'via_oficina', así que
 * el selector "Directo a faena" del solicitante era decorativo.
 */

function makeSession(): Session {
  return {
    user: {
      id: "user-1",
      name: "Tester",
      email: "tester@chome.cl",
      permissions: ["requests:create", "epp:create"],
      worksiteIds: ["ws-1"],
      roles: [],
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("worksiteId", "ws-1")
  fd.set("requestType", "epp")
  fd.set("urgency", "normal")
  fd.set("requiredDate", "2099-12-01")
  fd.set("notes", "")
  fd.set("itemsJson", JSON.stringify([{
    productId: "prod-1",
    productNameFree: null,
    quantity: 3,
    unitOfMeasure: "unidad",
    urgency: "normal",
    attributes: [],
  }]))
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe("parseRequestForm — despacho", () => {
  it("conserva 'directo_faena' elegido por el solicitante", () => {
    const result = parseRequestForm(makeSession(), makeFormData({ deliveryMode: "directo_faena" }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.deliveryMode).toBe("directo_faena")
  })

  it("usa 'via_oficina' cuando el formulario no manda el campo", () => {
    const result = parseRequestForm(makeSession(), makeFormData())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.deliveryMode).toBe("via_oficina")
  })

  it("rechaza un modo de despacho desconocido en vez de silenciarlo", () => {
    const result = parseRequestForm(makeSession(), makeFormData({ deliveryMode: "por_dron" }))
    expect(result.ok).toBe(false)
  })
})

describe("parseRequestForm — cantidad", () => {
  it("rechaza una cantidad vacía en vez de convertirla en 1", () => {
    // El cliente ya no coacciona con `|| 1`: un campo vacío llega como null.
    const fd = makeFormData()
    fd.set("itemsJson", JSON.stringify([{
      productId: "prod-1", productNameFree: null, quantity: null,
      unitOfMeasure: "unidad", urgency: "normal", attributes: [],
    }]))
    const result = parseRequestForm(makeSession(), fd)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/ítems/i)
  })
})
