/**
 * Señales de salud del panel de administración.
 *
 * La lógica que decide el tono vive separada de la que consulta la base de
 * datos por una razón concreta: lo único que puede equivocarse aquí son los
 * umbrales ("¿a las cuántas horas un respaldo está atrasado?"), y comprobarlos
 * no debería exigir levantar Postgres ni fijar el reloj del proceso. Por eso
 * `buildAdminSignals` recibe los hechos ya leídos y el `now` explícito.
 *
 * La ausencia de una clave en `AdminHealthFacts` significa "esta sesión no ve
 * ese destino en el árbol de administración", no "no hay datos": una sesión
 * sin acceso a `/admin/dte` no debe ver ni siquiera que la sincronización está
 * caída, porque el tile la llevaría a un /forbidden. Eso se comprueba abajo,
 * contra `getAdminHealthFacts`, que es donde vive la decisión.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ db: { select: mockSelect } }))

const mockGetLastDeliveryTest = vi.hoisted(() => vi.fn())
const mockGetResendStatus = vi.hoisted(() => vi.fn())
vi.mock("./smtp-settings", () => ({
  getLastDeliveryTest: mockGetLastDeliveryTest,
  getResendStatus:     mockGetResendStatus,
}))

const mockGetPlatformHealth = vi.hoisted(() => vi.fn())
vi.mock("./platform-health", () => ({ getPlatformHealth: mockGetPlatformHealth }))

import type { AreaNode } from "@/components/layout/nav-items"
import { buildAdminSignals, getAdminHealthFacts, visibleAdminHrefs } from "./admin-health"

const NOW = new Date("2026-09-12T12:00:00.000Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function signal(facts: Parameters<typeof buildAdminSignals>[0], id: string) {
  return buildAdminSignals(facts, NOW).find((s) => s.id === id)
}

describe("buildAdminSignals · visibilidad", () => {
  it("omite las señales cuyo destino no está en los hechos", () => {
    expect(buildAdminSignals({}, NOW)).toEqual([])
  })

  it("no expone el estado de un área que la sesión no puede abrir", () => {
    const signals = buildAdminSignals({ lockouts: { activeLocks: 0 } }, NOW)
    expect(signals.map((s) => s.id)).toEqual(["lockouts"])
  })

  it("nunca entrega más de cuatro tiles (regla de densidad A1)", () => {
    const signals = buildAdminSignals(
      {
        backup:   { latest: null, lastSuccessAt: null },
        email:    { configured: false, lastTest: null },
        dte:      { latest: null, lastSuccessAt: null },
        lockouts: { activeLocks: 3 },
        infra:    { db: "connected", storage: "writable", disk: "ok", freePercent: 60 },
      },
      NOW,
    )
    expect(signals).toHaveLength(4)
  })

  /**
   * Con un conjunto fijo de cuatro, el día que el disco se llenara la noticia
   * se vería sólo entrando a /admin/modulos mientras el panel seguía mostrando
   * cuatro verdes. Una señal sana no puede desplazar a una rota.
   */
  it("deja fuera la señal sana, no la rota, cuando hay cinco candidatas", () => {
    const signals = buildAdminSignals(
      {
        backup:   { latest: { status: "success", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(2) }, // ok
        email:    { configured: true, lastTest: { ok: true, attemptedAt: hoursAgo(2) } },                // ok
        dte:      { latest: { status: "success", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(2) }, // ok
        lockouts: { activeLocks: 0 },                                                                   // ok
        infra:    { db: "connected", storage: "unreachable", disk: "ok", freePercent: 60 },              // critical
      },
      NOW,
    )
    expect(signals).toHaveLength(4)
    expect(signals[0]?.id).toBe("infra")
    expect(signals.map((s) => s.id)).not.toContain("lockouts")
  })

  it("conserva el orden de catálogo entre señales del mismo tono", () => {
    const todoSano = {
      backup:   { latest: { status: "success", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(2) },
      email:    { configured: true, lastTest: { ok: true, attemptedAt: hoursAgo(2) } },
      dte:      { latest: { status: "success", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(2) },
      lockouts: { activeLocks: 0 },
    }
    expect(buildAdminSignals(todoSano, NOW).map((s) => s.id)).toEqual(["backup", "email", "dte", "lockouts"])
  })

  it("ordena las críticas antes que las de alerta y éstas antes que las sanas", () => {
    const signals = buildAdminSignals(
      {
        lockouts: { activeLocks: 2 },                                                                    // warn
        backup:   { latest: { status: "success", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(2) }, // ok
        email:    { configured: false, lastTest: null },                                                 // critical
      },
      NOW,
    )
    expect(signals.map((s) => s.tone)).toEqual(["critical", "warn", "ok"])
  })
})

describe("buildAdminSignals · respaldos", () => {
  it("marca crítico cuando nunca se ha ejecutado un respaldo", () => {
    const s = signal({ backup: { latest: null, lastSuccessAt: null } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.href).toBe("/admin/backups")
  })

  it("marca crítico cuando hubo intentos pero ninguno terminó bien", () => {
    const s = signal({ backup: { latest: { status: "failed", startedAt: hoursAgo(1) }, lastSuccessAt: null } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.detail).toMatch(/ha terminado bien/i)
  })

  it("marca crítico cuando el último intento falló, aunque haya un éxito reciente", () => {
    const s = signal({ backup: { latest: { status: "failed", startedAt: hoursAgo(1) }, lastSuccessAt: hoursAgo(5) } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.value).toBe("Falló")
  })

  it("considera sano un respaldo correcto dentro de las últimas 26 horas", () => {
    const s = signal({ backup: { latest: { status: "success", startedAt: hoursAgo(25) }, lastSuccessAt: hoursAgo(25) } }, "backup")
    expect(s?.tone).toBe("ok")
  })

  it("alerta cuando el último respaldo correcto pasó las 26 horas", () => {
    const s = signal({ backup: { latest: { status: "success", startedAt: hoursAgo(30) }, lastSuccessAt: hoursAgo(30) } }, "backup")
    expect(s?.tone).toBe("warn")
  })

  it("escala a crítico cuando el último respaldo correcto pasó las 48 horas", () => {
    const s = signal({ backup: { latest: { status: "success", startedAt: hoursAgo(50) }, lastSuccessAt: hoursAgo(50) } }, "backup")
    expect(s?.tone).toBe("critical")
  })

  it("no alarma por un respaldo en curso si el último correcto es reciente", () => {
    const s = signal({ backup: { latest: { status: "running", startedAt: hoursAgo(1) }, lastSuccessAt: hoursAgo(3) } }, "backup")
    expect(s?.tone).toBe("ok")
    expect(s?.value).toMatch(/curso/i)
  })

  /**
   * El fallo que este panel existe para delatar: un cron roto arranca una
   * corrida por hora y ninguna termina. Mirando sólo la última fila siempre
   * hay una `running` reciente, y el tile decía "En curso" para siempre
   * mientras la instalación llevaba días sin un respaldo completo.
   */
  it("mide la antigüedad contra el último respaldo correcto, no contra la última corrida", () => {
    const s = signal({ backup: { latest: { status: "running", startedAt: hoursAgo(1) }, lastSuccessAt: hoursAgo(72) } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.value).toBe("Atrasado")
  })

  /** Una corrida `running` que arrancó hace días no está en curso: quedó colgada. */
  it("trata como crítico un respaldo en curso desde hace más de 48 horas", () => {
    const s = signal({ backup: { latest: { status: "running", startedAt: hoursAgo(50) }, lastSuccessAt: hoursAgo(52) } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.value).toBe("Detenido")
  })

  /**
   * `formatDateRelative` cuenta días civiles y los umbrales cuentan horas: con
   * él solo, 25 h ("Al día") y 30 h ("Atrasado") decían los dos "ayer" y el
   * ámbar quedaba sin explicación visible.
   */
  it("distingue en el texto dos antigüedades que caen en el mismo día civil", () => {
    const sano = signal({ backup: { latest: { status: "success", startedAt: hoursAgo(25) }, lastSuccessAt: hoursAgo(25) } }, "backup")
    const viejo = signal({ backup: { latest: { status: "success", startedAt: hoursAgo(30) }, lastSuccessAt: hoursAgo(30) } }, "backup")
    expect(sano?.detail).toMatch(/hace 25 horas/)
    expect(viejo?.detail).toMatch(/hace 30 horas/)
  })

  it("no inventa una fecha cuando la del respaldo es ilegible", () => {
    const s = signal({ backup: { latest: { status: "success", startedAt: "no-es-fecha" }, lastSuccessAt: "no-es-fecha" } }, "backup")
    expect(s?.tone).toBe("critical")
    expect(s?.detail).toMatch(/no se pudo leer/i)
  })
})

describe("buildAdminSignals · correo", () => {
  it("marca crítico cuando no hay proveedor de correo configurado", () => {
    const s = signal({ email: { configured: false, lastTest: null } }, "email")
    expect(s?.tone).toBe("critical")
    expect(s?.href).toBe("/admin/correo-smtp")
  })

  it("alerta cuando está configurado pero nunca se probó el envío", () => {
    const s = signal({ email: { configured: true, lastTest: null } }, "email")
    expect(s?.tone).toBe("warn")
  })

  it("marca crítico cuando la última prueba de envío falló", () => {
    const s = signal({ email: { configured: true, lastTest: { ok: false, attemptedAt: hoursAgo(3) } } }, "email")
    expect(s?.tone).toBe("critical")
  })

  it("considera sano un envío de prueba exitoso", () => {
    const s = signal({ email: { configured: true, lastTest: { ok: true, attemptedAt: hoursAgo(3) } } }, "email")
    expect(s?.tone).toBe("ok")
  })
})

describe("buildAdminSignals · sincronización DTE", () => {
  it("alerta cuando nunca se ha sincronizado", () => {
    const s = signal({ dte: { latest: null, lastSuccessAt: null } }, "dte")
    expect(s?.tone).toBe("warn")
    expect(s?.href).toBe("/admin/dte")
  })

  it("marca crítico cuando la última corrida falló", () => {
    const s = signal({ dte: { latest: { status: "failed", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(30) } }, "dte")
    expect(s?.tone).toBe("critical")
  })

  it("alerta ante una corrida parcial", () => {
    const s = signal({ dte: { latest: { status: "partial", startedAt: hoursAgo(2) }, lastSuccessAt: hoursAgo(30) } }, "dte")
    expect(s?.tone).toBe("warn")
  })

  it("considera sana una corrida exitosa reciente", () => {
    const s = signal({ dte: { latest: { status: "success", startedAt: hoursAgo(6) }, lastSuccessAt: hoursAgo(6) } }, "dte")
    expect(s?.tone).toBe("ok")
  })

  it("alerta cuando la última corrida correcta pasó las 48 horas", () => {
    const s = signal({ dte: { latest: { status: "success", startedAt: hoursAgo(60) }, lastSuccessAt: hoursAgo(60) } }, "dte")
    expect(s?.tone).toBe("warn")
  })

  /** Una sincronización colgada no es una sincronización sana. */
  it("marca crítica una corrida en curso desde hace más de 48 horas", () => {
    const s = signal({ dte: { latest: { status: "running", startedAt: hoursAgo(60) }, lastSuccessAt: hoursAgo(70) } }, "dte")
    expect(s?.tone).toBe("critical")
    expect(s?.value).toBe("Detenida")
  })

  it("alerta cuando hay corridas pero ninguna terminó bien", () => {
    const s = signal({ dte: { latest: { status: "running", startedAt: hoursAgo(1) }, lastSuccessAt: null } }, "dte")
    expect(s?.tone).toBe("warn")
  })
})

describe("buildAdminSignals · bloqueos", () => {
  /**
   * A1 exige que un tile vacío muestre la acción, nunca un "0" pelado: cero
   * bloqueos es la buena noticia y así debe leerse.
   */
  it("dice la buena noticia en palabras cuando no hay bloqueos activos", () => {
    const s = signal({ lockouts: { activeLocks: 0 } }, "lockouts")
    expect(s?.tone).toBe("ok")
    expect(s?.value).toBe("Sin bloqueos")
  })

  it("alerta con el conteo cuando hay bloqueos activos", () => {
    const s = signal({ lockouts: { activeLocks: 3 } }, "lockouts")
    expect(s?.tone).toBe("warn")
    expect(s?.value).toBe("3")
    expect(s?.href).toBe("/admin/seguridad")
  })

  it("usa singular con un único bloqueo", () => {
    const s = signal({ lockouts: { activeLocks: 1 } }, "lockouts")
    expect(s?.detail).toMatch(/^1 acceso bloqueado/i)
  })

  /** `rate_limits.key` es un correo o una IP; "clave" se lee como contraseña. */
  it("no llama 'claves' a lo que son accesos", () => {
    const s = signal({ lockouts: { activeLocks: 2 } }, "lockouts")
    expect(s?.detail).not.toMatch(/clave/i)
  })
})

describe("buildAdminSignals · infraestructura", () => {
  const sana = { db: "connected", storage: "writable", disk: "ok", freePercent: 60 } as const

  it("marca crítico cuando la base no responde", () => {
    const s = signal({ infra: { ...sana, db: "disconnected" } }, "infra")
    expect(s?.tone).toBe("critical")
    expect(s?.href).toBe("/admin/modulos")
  })

  it("marca crítico cuando no se puede escribir en el almacenamiento", () => {
    const s = signal({ infra: { ...sana, storage: "unreachable" } }, "infra")
    expect(s?.tone).toBe("critical")
  })

  it("alerta ante poco espacio en disco y dice cuánto queda", () => {
    const s = signal({ infra: { ...sana, disk: "low_space", freePercent: 8 } }, "infra")
    expect(s?.tone).toBe("warn")
    expect(s?.detail).toMatch(/8% libre/)
  })

  it("escala a crítico bajo el 5% de disco libre", () => {
    const s = signal({ infra: { ...sana, disk: "low_space", freePercent: 3 } }, "infra")
    expect(s?.tone).toBe("critical")
  })

  it("no afirma un porcentaje que no midió", () => {
    const s = signal({ infra: { ...sana, disk: "low_space", freePercent: null } }, "infra")
    expect(s?.detail).toMatch(/poco espacio/i)
    expect(s?.detail).not.toMatch(/%/)
  })

  /** `disk: "unknown"` es no haber medido, no estar mal: no debe alarmar. */
  it("no alarma cuando el disco no se pudo medir", () => {
    const s = signal({ infra: { ...sana, disk: "unknown", freePercent: null } }, "infra")
    expect(s?.tone).toBe("ok")
  })
})

describe("visibleAdminHrefs", () => {
  it("recoge los hijos además de los ítems de primer nivel", () => {
    const areas: AreaNode[] = [{
      id: "catalogos", label: "Catálogos", iconName: "Stack", order: 10,
      items: [{
        label: "Catálogos de flota", href: "/admin/flota-catalogos", iconName: "GearSix",
        children: [{ label: "Vehículos", href: "/admin/flota-catalogos/vehiculos" }],
      }],
    }]
    expect([...visibleAdminHrefs(areas)]).toEqual([
      "/admin/flota-catalogos",
      "/admin/flota-catalogos/vehiculos",
    ])
  })
})

/**
 * La autorización real vive acá, no en `buildAdminSignals`: éste obedece a los
 * hechos que le entreguen. Lo que hay que fijar es que un destino invisible no
 * genere ni hecho ni consulta — ni fuga de estado, ni trabajo desperdiciado.
 */
describe("getAdminHealthFacts · sólo lee lo que la sesión ve", () => {
  const area = (label: string, href: string): AreaNode => ({
    id: href, label, iconName: "GearSix", order: 10,
    items: [{ label, href, iconName: "GearSix" }],
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetResendStatus.mockReturnValue({ configured: true, from: "x", apiKeyPrefix: "y" })
    mockGetLastDeliveryTest.mockResolvedValue(null)
    mockGetPlatformHealth.mockResolvedValue({
      status: "ok", db: "connected", storage: "writable",
      disk: { status: "ok", freePercent: 60 }, timestamp: "2026-09-12T12:00:00.000Z",
    })
    // Encadenado mínimo de drizzle: select().from().where().orderBy().limit()
    // resuelve a una lista vacía, y el `.then` del servicio la convierte en null.
    const chain: Record<string, unknown> = {}
    for (const method of ["from", "where", "orderBy", "limit"]) chain[method] = vi.fn(() => chain)
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve([]))
    mockSelect.mockReturnValue(chain)
  })

  it("no entrega ningún hecho ni consulta nada sin destinos visibles", async () => {
    const facts = await getAdminHealthFacts([])
    expect(Object.keys(facts)).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockGetLastDeliveryTest).not.toHaveBeenCalled()
    expect(mockGetPlatformHealth).not.toHaveBeenCalled()
  })

  /**
   * La sonda escribe un archivo y ejecuta `df`: no se paga si la sesión no ve
   * el destino al que el tile la llevaría.
   */
  it("no sondea la infraestructura de quien no ve /admin/modulos", async () => {
    const facts = await getAdminHealthFacts([area("Respaldos", "/admin/backups")])
    expect(facts.infra).toBeUndefined()
    expect(mockGetPlatformHealth).not.toHaveBeenCalled()
  })

  it("sondea la infraestructura cuando /admin/modulos es visible", async () => {
    const facts = await getAdminHealthFacts([area("Módulos", "/admin/modulos")])
    expect(mockGetPlatformHealth).toHaveBeenCalledOnce()
    expect(facts.infra).toEqual({ db: "connected", storage: "writable", disk: "ok", freePercent: 60 })
  })

  /** Sin sonda no se afirma que la infraestructura esté sana: se omite el tile. */
  it("omite el tile de infraestructura si la sonda falla entera", async () => {
    mockGetPlatformHealth.mockRejectedValue(new Error("df no existe"))
    const facts = await getAdminHealthFacts([area("Módulos", "/admin/modulos")])
    expect(facts.infra).toBeUndefined()
  })

  it("no expone el estado de DTE a quien no ve /admin/dte", async () => {
    const facts = await getAdminHealthFacts([area("Respaldos", "/admin/backups")])
    expect(Object.keys(facts)).toEqual(["backup"])
    expect(facts.dte).toBeUndefined()
    expect(facts.email).toBeUndefined()
    expect(facts.lockouts).toBeUndefined()
    expect(mockGetLastDeliveryTest).not.toHaveBeenCalled()
  })

  it("entrega las cuatro claves cuando los cuatro destinos son visibles", async () => {
    const facts = await getAdminHealthFacts([
      area("Respaldos", "/admin/backups"),
      area("Correo", "/admin/correo-smtp"),
      area("DTE", "/admin/dte"),
      area("Seguridad", "/admin/seguridad"),
    ])
    expect(Object.keys(facts).sort()).toEqual(["backup", "dte", "email", "lockouts"])
    expect(mockGetLastDeliveryTest).toHaveBeenCalledOnce()
  })

  it("degrada el tile en vez de tumbar la página cuando una consulta falla", async () => {
    mockSelect.mockImplementation(() => { throw new Error("postgres caído") })
    mockGetLastDeliveryTest.mockRejectedValue(new Error("resend caído"))

    const facts = await getAdminHealthFacts([
      area("Respaldos", "/admin/backups"),
      area("Correo", "/admin/correo-smtp"),
    ])
    expect(facts.backup).toEqual({ latest: null, lastSuccessAt: null })
    expect(facts.email?.lastTest).toBeNull()
  })
})
