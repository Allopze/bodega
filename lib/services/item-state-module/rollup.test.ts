/**
 * La regla que deriva el estado de una solicitud desde el de sus ítems.
 *
 * Estaba embebida en `rollupRequestStatus`, que escribe, así que nunca se pudo
 * comprobar sola. Se extrajo al agregar el reconciliador de estados
 * (`reconcile-request-status`), que necesita calcular el estado esperado sin
 * escribir para poder informar en dry-run — y hacerlo reusando esta regla en
 * vez de una segunda opinión sobre cuándo cierra una solicitud.
 */
import { describe, expect, it } from "vitest"
import { deriveRequestStatus } from "./rollup"

describe("deriveRequestStatus", () => {
  it("cierra cuando todo llegó a faena", () => {
    // Es la regla que `0a5bb3f1` (2026-09-02) devolvió: la adquisición termina
    // cuando el ítem llegó completo a faena, sin esperar la distribución.
    expect(deriveRequestStatus(["received"])).toBe("closed")
    expect(deriveRequestStatus(["received", "received"])).toBe("closed")
    expect(deriveRequestStatus(["received", "rejected"])).toBe("closed")
    expect(deriveRequestStatus(["delivered"])).toBe("closed")
  })

  it("no cierra con un ítem recibido sólo en oficina", () => {
    // El flujo de dos etapas: `office_received` es recibido en oficina y
    // todavía tiene que llegar a faena.
    expect(deriveRequestStatus(["received", "office_received"])).toBe("in_purchasing")
    expect(deriveRequestStatus(["office_received"])).toBe("in_purchasing")
    expect(deriveRequestStatus(["received", "partially_received"])).toBe("in_purchasing")
    expect(deriveRequestStatus(["received", "partially_delivered"])).toBe("in_purchasing")
  })

  it("un ítem sin revisar manda a revisión, aunque el resto esté recibido", () => {
    expect(deriveRequestStatus(["requested"])).toBe("in_review")
    expect(deriveRequestStatus(["received", "requested"])).toBe("in_review")
  })

  it("rechaza sólo cuando se rechazó todo", () => {
    expect(deriveRequestStatus(["rejected"])).toBe("rejected")
    expect(deriveRequestStatus(["rejected", "rejected"])).toBe("rejected")
  })

  it("distingue aprobada de parcialmente aprobada", () => {
    expect(deriveRequestStatus(["approved"])).toBe("approved")
    expect(deriveRequestStatus(["approved", "rejected"])).toBe("approved")
    expect(deriveRequestStatus(["approved", "pending_purchase"])).toBe("approved")
  })

  it("compra en curso cuando algo ya salió a comprar", () => {
    expect(deriveRequestStatus(["purchased"])).toBe("in_purchasing")
    expect(deriveRequestStatus(["in_purchase_order", "approved"])).toBe("in_purchasing")
  })
})
