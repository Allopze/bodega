import { describe, it, expect } from "vitest"
import { deriveProviderStatus } from "../health"

describe("deriveProviderStatus", () => {
  it("«sin configurar» NO es «con problema»", () => {
    const status = deriveProviderStatus({ enabled: true, configured: false, stored: null })

    expect(status.kind).toBe("unconfigured")
    expect(status.label).toBe("Sin configurar")
    // El rojo se reserva para fallas reales: pintar de rojo una tarea pendiente
    // enseña a ignorar el rojo.
    expect(status.tone).not.toBe("danger")
    expect(status.detail).toMatch(/no es una falla/i)
  })

  it("un proveedor apagado por flag se muestra neutro, no como error", () => {
    const status = deriveProviderStatus({ enabled: false, configured: true, stored: null })
    expect(status.kind).toBe("disabled")
    expect(status.tone).toBe("neutral")
  })

  it("el flag apagado manda sobre la falta de credenciales", () => {
    const status = deriveProviderStatus({ enabled: false, configured: false, stored: null })
    expect(status.kind).toBe("disabled")
  })

  it("configurado pero nunca comprobado no finge estar sano", () => {
    const status = deriveProviderStatus({ enabled: true, configured: true, stored: null })

    expect(status.kind).toBe("unchecked")
    expect(status.tone).toBe("neutral")
    // Sin fecha de comprobación no se puede afirmar nada sobre el proveedor.
    expect(status.checkedAt).toBeNull()
  })

  it("refleja el último estado guardado, con su fecha", () => {
    const checkedAt = "2026-08-05T12:00:00.000Z"

    const ok = deriveProviderStatus({
      enabled: true, configured: true,
      stored: { ok: true, detail: "Portal accesible.", checkedAt },
    })
    expect(ok.kind).toBe("ok")
    expect(ok.tone).toBe("success")
    expect(ok.checkedAt).toBe(checkedAt)

    const failing = deriveProviderStatus({
      enabled: true, configured: true,
      stored: { ok: false, detail: "El portal no respondió.", checkedAt },
    })
    expect(failing.kind).toBe("failing")
    expect(failing.tone).toBe("danger")
    // El detalle del proveedor se muestra tal cual: ya viene redactado.
    expect(failing.detail).toBe("El portal no respondió.")
  })

  it("los cinco estados son distinguibles por texto, no solo por color", () => {
    const labels = [
      deriveProviderStatus({ enabled: false, configured: true, stored: null }),
      deriveProviderStatus({ enabled: true, configured: false, stored: null }),
      deriveProviderStatus({ enabled: true, configured: true, stored: null }),
      deriveProviderStatus({ enabled: true, configured: true, stored: { ok: true, detail: "x", checkedAt: "2026-08-05T00:00:00Z" } }),
      deriveProviderStatus({ enabled: true, configured: true, stored: { ok: false, detail: "y", checkedAt: "2026-08-05T00:00:00Z" } }),
    ].map((status) => status.label)

    expect(new Set(labels).size).toBe(5)
  })
})
