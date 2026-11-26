// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/**
 * Atajos de folio de la paleta de comandos (auditoría de encontrabilidad 2026-11-26): `OT-`, `MP-`, `MC-` y `NP-`
 * saltan a `/mantencion/ir?folio=…`, que resuelve el folio en el servidor. Se ofrecen sólo a quien ve la lista
 * correspondiente en el menú (los destinos que la paleta ya filtra por permiso y por módulos habilitados).
 */

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { CommandPalette, codeShortcutsFor } from "./command-palette"
import { consumePendingOpen, requestOpenCommandPalette } from "./command-palette-events"

function sessionWith(permissions: string[]): Session {
  return {
    expires: "2030-01-01T00:00:00.000Z",
    user: { id: "u-1", name: "Prueba", email: "prueba@test.cl", roles: [], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
  }
}

const OT = ["mant:ot:view_worksite"]
const REGISTROS = ["mant:records:view_worksite"]
const NOTAS = ["mant:np:view_worksite"]

/** Abre la paleta como lo hace el botón «Ir a…» y deja el cuadro de búsqueda a mano. */
async function abrir(session: Session, props: { enabledModuleIds?: string[]; disabledSubmoduleHrefs?: string[] } = {}) {
  render(<CommandPalette session={session} {...props} />)
  act(() => { requestOpenCommandPalette() })
  return screen.findByRole("textbox", { name: "Buscar páginas" })
}

const escribir = (input: HTMLElement, texto: string) => fireEvent.change(input, { target: { value: texto } })
/** La fila resultado de la paleta: su nombre accesible trae también el contexto («Control operacional · Mantención»). */
const opcion = (nombre: string | RegExp) =>
  screen.queryByRole("button", { name: typeof nombre === "string" ? new RegExp(nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : nombre })

beforeEach(() => {
  // jsdom no trae `scrollIntoView`; la paleta lo usa para seguir la fila resaltada.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  consumePendingOpen()
  vi.clearAllMocks()
})

describe("atajos de folio de Mantención", () => {
  it.each([
    ["ot-bio-0001", OT, "Abrir la orden de trabajo OT-BIO-0001", "/mantencion/ir?folio=OT-BIO-0001"],
    ["MP-STF-0147", REGISTROS, "Abrir el registro firmado MP-STF-0147", "/mantencion/ir?folio=MP-STF-0147"],
    ["mc-stf-0002", REGISTROS, "Abrir el registro firmado MC-STF-0002", "/mantencion/ir?folio=MC-STF-0002"],
    ["np-2026-0007", NOTAS, "Abrir la nota de pedido NP-2026-0007", "/mantencion/ir?folio=NP-2026-0007"],
  ])("«%s» ofrece saltar al folio, en mayúsculas, a quien ve su lista", async (escrito, permisos, rotulo, destino) => {
    const input = await abrir(sessionWith(permisos))
    escribir(input, `  ${escrito}  `)
    const salto = opcion(rotulo)
    expect(salto).toBeTruthy()
    // Dice dónde está: el área y el grupo del menú.
    expect(salto!.textContent).toContain("Control operacional · Mantención")
    fireEvent.click(salto!)
    expect(push).toHaveBeenCalledWith(destino)
  })

  it("Enter sobre el atajo (primera fila) abre el folio, sin tocar el ratón", async () => {
    const input = await abrir(sessionWith(OT))
    escribir(input, "OT-BIO-0001")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/mantencion/ir?folio=OT-BIO-0001")
  })

  it("cada atajo se ofrece sólo a quien ve la lista correspondiente", async () => {
    const input = await abrir(sessionWith(OT))
    escribir(input, "MP-STF-0147")
    expect(opcion(/Abrir el registro firmado/)).toBeNull()
    escribir(input, "NP-2026-0007")
    expect(opcion(/Abrir la nota de pedido/)).toBeNull()
    escribir(input, "OT-BIO-0001")
    expect(opcion(/Abrir la orden de trabajo/)).toBeTruthy()
  })

  it("quien no ve nada de Mantención no recibe ningún atajo de folio, pero conserva los de Solicitudes y Compras", async () => {
    const input = await abrir(sessionWith([]))
    for (const folio of ["OT-BIO-0001", "MP-STF-0147", "MC-STF-0002", "NP-2026-0007"]) {
      escribir(input, folio)
      expect(opcion(/Abrir (la|el) /), folio).toBeNull()
    }
    escribir(input, "SOL-2026-0001")
    expect(opcion('Buscar "SOL-2026-0001" en Solicitudes')).toBeTruthy()
    escribir(input, "OC-2026-0001")
    expect(opcion('Buscar "OC-2026-0001" en Compras')).toBeTruthy()
  })

  it("un submódulo apagado por interruptor no ofrece su atajo aunque la persona tenga el permiso", async () => {
    const input = await abrir(sessionWith([...OT, ...REGISTROS]), { disabledSubmoduleHrefs: ["/mantencion/ot"] })
    escribir(input, "OT-BIO-0001")
    expect(opcion(/Abrir la orden de trabajo/)).toBeNull()
    escribir(input, "MP-STF-0147")
    expect(opcion(/Abrir el registro firmado/)).toBeTruthy()
  })

  it("un módulo apagado tampoco ofrece el atajo", async () => {
    const input = await abrir(sessionWith(OT), { enabledModuleIds: ["flota"] })
    escribir(input, "OT-BIO-0001")
    expect(opcion(/Abrir la orden de trabajo/)).toBeNull()
  })

  it("sin el guion y algo después, «ot» o «np» son pedazos de palabras y no un folio", async () => {
    const input = await abrir(sessionWith([...OT, ...NOTAS, ...REGISTROS]))
    for (const texto of ["ot", "OT-", "mp", "np", "mc-", "otros", "npm"]) {
      escribir(input, texto)
      expect(opcion(/Abrir (la|el) /), texto).toBeNull()
    }
  })

  it("«Ir a…» sigue encontrando las páginas del menú por su nombre", async () => {
    const input = await abrir(sessionWith(OT))
    escribir(input, "órdenes")
    const salto = opcion(/Órdenes de trabajo/)
    expect(salto).toBeTruthy()
    fireEvent.click(salto!)
    expect(push).toHaveBeenCalledWith("/mantencion/ot")
  })

  it("el cuadro de búsqueda cuenta qué folios entiende", async () => {
    const input = await abrir(sessionWith(OT))
    const pista = input.getAttribute("placeholder") ?? ""
    for (const prefijo of ["SOL-", "OC-", "OT-", "MP-", "MC-", "NP-"]) expect(pista).toContain(prefijo)
  })
})

describe("codeShortcutsFor", () => {
  const destinos = (...hrefs: string[]) => hrefs.map((href) => ({ href }))

  it("sin el destino del menú no hay atajo; con él, uno por folio", () => {
    expect(codeShortcutsFor("OT-BIO-0001", destinos("/dashboard"))).toEqual([])
    const [atajo, ...otros] = codeShortcutsFor("ot-bio-0001", destinos("/mantencion/ot"))
    expect(otros).toEqual([])
    expect(atajo).toMatchObject({ href: "/mantencion/ir?folio=OT-BIO-0001", label: "Abrir la orden de trabajo OT-BIO-0001", areaLabel: "Control operacional", groupLabel: "Mantención" })
  })

  it("el folio viaja codificado y sin espacios a los lados", () => {
    const [atajo] = codeShortcutsFor("  np-2026/0007 ", destinos("/mantencion/notas-pedido"))
    expect(atajo?.href).toBe("/mantencion/ir?folio=NP-2026%2F0007")
  })

  it("Solicitudes y Compras se ofrecen a todos, como antes", () => {
    expect(codeShortcutsFor("SOL-1", []).map((atajo) => atajo.areaLabel)).toEqual(["Adquisiciones"])
    expect(codeShortcutsFor("OC-1", []).map((atajo) => atajo.areaLabel)).toEqual(["Adquisiciones"])
  })
})

describe("abrir la paleta desde fuera", () => {
  it("el evento del botón «Ir a…» abre la paleta", async () => {
    render(<CommandPalette session={sessionWith([])} />)
    expect(screen.queryByRole("textbox", { name: "Buscar páginas" })).toBeNull()
    act(() => { requestOpenCommandPalette() })
    expect(await screen.findByRole("textbox", { name: "Buscar páginas" })).toBeTruthy()
  })

  it("una petición hecha antes de que cargara la paleta (React.lazy) se atiende al montarse", async () => {
    requestOpenCommandPalette()
    render(<CommandPalette session={sessionWith([])} />)
    expect(await screen.findByRole("textbox", { name: "Buscar páginas" })).toBeTruthy()
    // Ya atendida: no queda pendiente para abrirla otra vez.
    expect(consumePendingOpen()).toBe(false)
  })

  it("Ctrl+K sigue abriéndola", async () => {
    render(<CommandPalette session={sessionWith([])} />)
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(await screen.findByRole("textbox", { name: "Buscar páginas" })).toBeTruthy()
  })
})
