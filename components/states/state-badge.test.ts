import { describe, expect, it } from "vitest"
import {
  DISPATCH_GUIDE_STATE_META,
  ITEM_STATE_META,
  OC_STATE_META,
  REQUEST_STATE_META,
} from "./state-badge"

/**
 * TRV-03 (auditoría UI/UX 2026-10-05): el `Badge` rinde las severidades en mono
 * MAYÚSCULAS y `default`/`info` en prosa. El mapa daba el grito a lo cerrado y
 * el susurro a lo que pide acción. Estos casos fijan la regla, no sólo los
 * valores: `signal` = alguien debe actuar ahora; terminales = prosa calma.
 */
const CALM = ["default", "info"] as const

describe("estado → variante en la cadena de adquisición (TRV-03)", () => {
  it("lo que pide acción de alguien es `signal`", () => {
    // Quien aprueba decide.
    expect(REQUEST_STATE_META.submitted.variant).toBe("signal")
    expect(REQUEST_STATE_META.in_review.variant).toBe("signal")
    expect(ITEM_STATE_META.requested.variant).toBe("signal")
    // Quien compra genera/emite la OC.
    expect(REQUEST_STATE_META.approved.variant).toBe("signal")
    expect(ITEM_STATE_META.approved.variant).toBe("signal")
    expect(ITEM_STATE_META.pending_purchase.variant).toBe("signal")
    expect(ITEM_STATE_META.in_purchase_order.variant).toBe("signal")
    expect(OC_STATE_META.draft.variant).toBe("signal")
    // Quien recibe registra la llegada de una OC enviada.
    expect(OC_STATE_META.sent.variant).toBe("signal")
    expect(ITEM_STATE_META.purchased.variant).toBe("signal")
    // La oficina despacha lo que llegó; la faena confirma lo despachado.
    expect(OC_STATE_META.office_received.variant).toBe("signal")
    expect(ITEM_STATE_META.office_received.variant).toBe("signal")
    expect(DISPATCH_GUIDE_STATE_META.draft.variant).toBe("signal")
    expect(DISPATCH_GUIDE_STATE_META.dispatched.variant).toBe("signal")
  })

  it("los estados terminales y rutinarios no gritan", () => {
    for (const meta of [
      OC_STATE_META.closed, OC_STATE_META.received, OC_STATE_META.cancelled,
      REQUEST_STATE_META.closed, REQUEST_STATE_META.cancelled,
      ITEM_STATE_META.received, ITEM_STATE_META.delivered,
      DISPATCH_GUIDE_STATE_META.received, DISPATCH_GUIDE_STATE_META.cancelled,
    ]) {
      expect(CALM).toContain(meta.variant)
    }
  })

  it("el borrador privado de una solicitud es calmo", () => {
    expect(CALM).toContain(REQUEST_STATE_META.draft.variant)
    expect(CALM).toContain(ITEM_STATE_META.draft.variant)
  })

  it("parcial = warning; rechazo = danger; anular no es alarma", () => {
    expect(OC_STATE_META.partially_received.variant).toBe("warning")
    expect(OC_STATE_META.partially_office_received.variant).toBe("warning")
    expect(DISPATCH_GUIDE_STATE_META.partially_received.variant).toBe("warning")
    expect(REQUEST_STATE_META.partially_approved.variant).toBe("warning")
    expect(REQUEST_STATE_META.rejected.variant).toBe("danger")
    expect(ITEM_STATE_META.rejected.variant).toBe("danger")
    expect(OC_STATE_META.cancelled.variant).not.toBe("danger")
    expect(DISPATCH_GUIDE_STATE_META.cancelled.variant).not.toBe("danger")
  })

  it("`family` sigue a `variant` en los signal (lleva el borde reforzado)", () => {
    for (const map of [ITEM_STATE_META, REQUEST_STATE_META, OC_STATE_META, DISPATCH_GUIDE_STATE_META]) {
      for (const meta of Object.values(map)) {
        if (meta.variant === "signal") expect(meta.family).toBe("signal")
      }
    }
  })
})

describe("vocabulario canónico de «esperando al proveedor» (ADQ-10)", () => {
  it("ítem comprado, OC enviada comparten un solo nombre", () => {
    expect(OC_STATE_META.sent.label).toBe("Pendiente de recepción")
    expect(ITEM_STATE_META.purchased.label).toBe("Pendiente de recepción")
  })

  it("«En proceso» y «Comprado» ya no existen como estado de la cadena", () => {
    const labels = [
      ...Object.values(ITEM_STATE_META), ...Object.values(REQUEST_STATE_META),
      ...Object.values(OC_STATE_META), ...Object.values(DISPATCH_GUIDE_STATE_META),
    ].map((meta) => meta.label)
    expect(labels).not.toContain("En proceso")
    expect(labels).not.toContain("Comprado")
    expect(REQUEST_STATE_META.in_purchasing.label).toBe("En curso")
  })

  it("un ítem de OC en borrador se lee como pendiente de emisión, no de recepción", () => {
    expect(ITEM_STATE_META.in_purchase_order.label).toBe("OC por emitir")
  })
})
