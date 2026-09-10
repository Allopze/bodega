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

/** Ítem cuyo estado alcanza para decidir, sin depender de cantidades. */
const it_ = (status: string, fullyReceived = true) => ({ status, fullyReceived })

describe("deriveRequestStatus", () => {
  it("cierra cuando todo llegó a faena", () => {
    // Es la regla que `0a5bb3f1` (2026-09-02) devolvió: la adquisición termina
    // cuando el ítem llegó completo a faena, sin esperar la distribución.
    expect(deriveRequestStatus([it_("received")])).toBe("closed")
    expect(deriveRequestStatus([it_("received"), it_("received")])).toBe("closed")
    expect(deriveRequestStatus([it_("received"), it_("rejected")])).toBe("closed")
    expect(deriveRequestStatus([it_("delivered")])).toBe("closed")
  })

  it("no cierra con un ítem recibido sólo en oficina", () => {
    // El flujo de dos etapas: `office_received` es recibido en oficina y
    // todavía tiene que llegar a faena.
    expect(deriveRequestStatus([it_("received"), it_("office_received")])).toBe("in_purchasing")
    expect(deriveRequestStatus([it_("office_received")])).toBe("in_purchasing")
    expect(deriveRequestStatus([it_("received"), it_("partially_received")])).toBe("in_purchasing")
    expect(deriveRequestStatus([it_("received"), it_("partially_delivered", false)])).toBe("in_purchasing")
  })

  it("cierra con `partially_delivered` sólo si las cantidades muestran llegada completa", () => {
    // `partially_delivered` es ambiguo: se alcanza desde `received` (llegó todo,
    // se repartió parte) y desde `partially_received` (llegó parte, se repartió
    // parte), y al recibir el saldo *conserva* ese estado. El estado solo no
    // distingue los dos casos, así que la señal es la cantidad recibida.
    //
    // Caso real: SOL-0001 con 50 pedidas y 50 en faena cierra; SOL-0027 con 3
    // pedidas y 2 en faena no.
    expect(deriveRequestStatus([it_("partially_delivered", true)])).toBe("closed")
    expect(deriveRequestStatus([it_("partially_delivered", false)])).toBe("in_purchasing")
    expect(deriveRequestStatus([
      it_("received"), it_("partially_delivered", true), it_("rejected"),
    ])).toBe("closed")
    // SOL-0027: un ítem entregado del todo y otro con saldo por llegar.
    expect(deriveRequestStatus([
      it_("delivered"), it_("partially_delivered", false),
    ])).toBe("in_purchasing")
  })

  it("un ítem sin revisar manda a revisión, aunque el resto esté recibido", () => {
    expect(deriveRequestStatus([it_("requested")])).toBe("in_review")
    expect(deriveRequestStatus([it_("received"), it_("requested")])).toBe("in_review")
  })

  it("rechaza sólo cuando se rechazó todo", () => {
    expect(deriveRequestStatus([it_("rejected")])).toBe("rejected")
    expect(deriveRequestStatus([it_("rejected"), it_("rejected")])).toBe("rejected")
  })

  it("distingue aprobada de parcialmente aprobada", () => {
    expect(deriveRequestStatus([it_("approved")])).toBe("approved")
    expect(deriveRequestStatus([it_("approved"), it_("rejected")])).toBe("approved")
    expect(deriveRequestStatus([it_("approved"), it_("pending_purchase")])).toBe("approved")
  })

  it("compra en curso cuando algo ya salió a comprar", () => {
    expect(deriveRequestStatus([it_("purchased")])).toBe("in_purchasing")
    expect(deriveRequestStatus([it_("in_purchase_order"), it_("approved")])).toBe("in_purchasing")
  })
})
