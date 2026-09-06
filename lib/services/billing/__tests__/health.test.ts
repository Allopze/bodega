import { describe, it, expect } from "vitest"
import { deriveProviderStatus } from "../health"

describe("deriveProviderStatus", () => {
  it("«sin configurar» NO es «con problema»", () => {
    const status = deriveProviderStatus({ enabled: true, configured: false, stored: null })

    expect(status.kind).toBe("unconfigured")
    expect(status.label).toBe("Sin configurar")
    // El rojo se reserva para fallas reales: pintar de rojo una tarea pendiente
    // enseña a ignorar el rojo.
    expect(status.variant).not.toBe("danger")
    expect(status.detail).toMatch(/no es una falla/i)
  })

  it("un proveedor apagado por flag se muestra neutro, no como error", () => {
    const status = deriveProviderStatus({ enabled: false, configured: true, stored: null })
    expect(status.kind).toBe("disabled")
    expect(status.variant).toBe("neutral")
  })

  it("el flag apagado manda sobre la falta de credenciales", () => {
    const status = deriveProviderStatus({ enabled: false, configured: false, stored: null })
    expect(status.kind).toBe("disabled")
  })

  it("configurado pero nunca comprobado no finge estar sano", () => {
    const status = deriveProviderStatus({ enabled: true, configured: true, stored: null })

    expect(status.kind).toBe("unchecked")
    expect(status.variant).toBe("neutral")
    // Sin fecha de comprobación no se puede afirmar nada sobre el proveedor.
    expect(status.checkedAt).toBeNull()
  })

  it("refleja el último estado guardado, con su fecha", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1_000).toISOString()

    const ok = deriveProviderStatus({
      enabled: true, configured: true,
      stored: { ok: true, detail: "Portal accesible.", checkedAt },
      now: new Date(),
    })
    expect(ok.kind).toBe("ok")
    expect(ok.variant).toBe("success")
    expect(ok.checkedAt).toBe(checkedAt)

    const failing = deriveProviderStatus({
      enabled: true, configured: true,
      stored: { ok: false, detail: "El portal no respondió.", checkedAt },
      now: new Date(),
    })
    expect(failing.kind).toBe("failing")
    expect(failing.variant).toBe("danger")
    // El detalle del proveedor se muestra tal cual: ya viene redactado.
    expect(failing.detail).toBe("El portal no respondió.")
  })

  it("marca como vencida una comprobación exitosa de más de 24 horas", () => {
    const now = new Date("2026-08-13T12:00:00.000Z")
    const status = deriveProviderStatus({
      enabled: true,
      configured: true,
      stored: { ok: true, detail: "ok", checkedAt: "2026-08-11T11:59:00.000Z" },
      now,
    })
    expect(status.kind).toBe("stale")
    expect(status.label).toBe("Comprobación vencida")
  })

  it("un «Con problema» de hace meses se muestra vencido, no vigente", () => {
    // Nadie refresca el valor salvo el botón «Probar conexión», y la tarjeta roja
    // es justo lo que la gente deja de pulsar: sin TTL, un fallo de junio se
    // presenta igual que una caída real de ayer y enseña a ignorar el rojo.
    const status = deriveProviderStatus({
      enabled: true,
      configured: true,
      stored: { ok: false, detail: "Chipax no respondió.", checkedAt: "2026-06-01T09:00:00.000Z" },
      now: new Date("2026-08-19T09:00:00.000Z"),
    })

    expect(status.kind).toBe("stale")
    expect(status.label).toBe("Comprobación vencida")
    // El diagnóstico anterior no se pierde: se rotula como viejo.
    expect(status.detail).toContain("Chipax no respondió.")
  })

  it("los seis estados son distinguibles por texto, no solo por color", () => {
    const now = new Date("2026-08-05T06:00:00Z")
    const reciente = "2026-08-05T00:00:00Z"
    const labels = [
      deriveProviderStatus({ enabled: false, configured: true, stored: null }),
      deriveProviderStatus({ enabled: true, configured: false, stored: null }),
      deriveProviderStatus({ enabled: true, configured: true, stored: null }),
      deriveProviderStatus({ enabled: true, configured: true, stored: { ok: true, detail: "x", checkedAt: reciente }, now }),
      deriveProviderStatus({ enabled: true, configured: true, stored: { ok: true, detail: "stale", checkedAt: reciente }, now: new Date("2026-08-13T00:00:00Z") }),
      deriveProviderStatus({ enabled: true, configured: true, stored: { ok: false, detail: "y", checkedAt: reciente }, now }),
    ].map((status) => status.label)

    expect(new Set(labels).size).toBe(6)
  })
})
