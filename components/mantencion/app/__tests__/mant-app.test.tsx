// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { webcrypto } from "node:crypto"
import { Blob as NodeBlob } from "node:buffer"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { catalog, equipment, freshDb } from "@/lib/mantencion/client/__tests__/fixtures"
import { MantApp, resetBootForTests } from "../mant-app"

// El Blob de Node no entra a un FormData de jsdom: la subida de la foto se hace con una petición simple (la forma real del multipart se prueba en catalog-api.test.ts).
vi.mock("@/lib/mantencion/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mantencion/client/api")>()),
  uploadPhoto: vi.fn(async (token: string, photo: { id: string }) => {
    await fetch(`/api/mantencion/sync/fotos/${photo.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } })
    return { kind: "ok" as const, value: null }
  }),
}))
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), getSession: vi.fn(async () => null) }))
// Sin canvas en jsdom: la foto «sacada» es un Blob de Node (que IndexedDB sí sabe guardar).
vi.mock("@/lib/mantencion/client/photo-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mantencion/client/photo-capture")>()),
  capturePhoto: vi.fn(async () => ({
    blob: new NodeBlob(["jpeg"], { type: "image/jpeg" }) as unknown as Blob,
    width: 1600, height: 1200, sha256: "b".repeat(64), stampedAt: new Date().toISOString(), takenAtExif: null, exif: null,
  })),
}))

const USER = { id: "u-1", name: "Javier Roa", email: "javier@e2e.chome.cl" }
const CATALOG = catalog("u-1", [equipment({ readings: [{ value: 39_900, date: "2026-10-01", source: "MP-BIO-0001" }], state: "proxima", remaining: 100, nextReading: 40_000 })])
const calls: Array<{ method: string; url: string; auth: string | null }> = []

function installServer(options: { online: boolean; catalog?: typeof CATALOG }) {
  Object.defineProperty(navigator, "onLine", { value: options.online, configurable: true })
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? "GET"
    calls.push({ method, url: path, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null })
    if (!navigator.onLine) throw new TypeError("Failed to fetch")
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
    if (path.endsWith("/api/mantencion/dispositivo")) return json({ token: "token-u-1", expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), user: USER })
    if (path.includes("/sync/catalogo")) return path.includes("alcance=todos") ? json({ version: "o1", equipment: [] }, 200, { etag: '"o1"' }) : json(options.catalog ?? CATALOG, 200, { etag: '"v1"' })
    if (method === "PUT") return new Response(null, { status: 200 })
    if (method === "POST" && path.endsWith("/sync/registros")) {
      const body = JSON.parse(String(init?.body)) as { id: string }
      return json({ ok: true, id: body.id, folio: "MP-BIO-0042", receivedAt: new Date().toISOString(), duplicate: false, warnings: [] })
    }
    return json({}, 404)
  }))
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const typePin = (pin: string) => { for (const digit of pin) fireEvent.click(within(screen.getByRole("group", { name: "Teclado numérico" })).getByRole("button", { name: digit })) }

async function openAndDefinePin() {
  render(<MantApp sessionUser={USER} appVersion="test" renderedAt={new Date().toISOString()} />)
  await screen.findByRole("heading", { name: "Define tu PIN" })
  typePin("1234")
  await screen.findByRole("heading", { name: "Repite tu PIN" })
  typePin("1234")
  // El saludo también está en la pantalla del PIN: la de inicio se reconoce por «Nuevo registro» y por traer el catálogo.
  await screen.findByRole("region", { name: "Nuevo registro" })
  await screen.findByRole("region", { name: "Le toca mantención" })
}

/** Preventiva completa desde «Le toca mantención» hasta «Firmar y guardar». */
async function signPreventive() {
  const due = screen.getByRole("region", { name: "Le toca mantención" })
  fireEvent.click(within(due).getByRole("button", { name: /KA-140/ }))
  expect(await screen.findByText("PASO 2/5")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Odómetro actual"), { target: { value: "40010" } })
  expect(await screen.findByText(/toca la de/)).toBeTruthy()
  expect(screen.getByLabelText("Odómetro actual")).toHaveProperty("value", "40.010")
  click("Ver pauta")

  // «Continuar» no se bloquea: valida al tocarlo, dice cuántos ítems faltan y se queda en la pauta.
  expect(screen.getByRole("button", { name: "Continuar a fotos" })).toHaveProperty("disabled", false)
  click("Continuar a fotos")
  expect(await screen.findByText("Faltan 4 ítems por marcar.")).toBeTruthy()
  expect(screen.getByText("PASO 3/5")).toBeTruthy()
  expect(screen.getByText("Confirmar con pauta del fabricante")).toBeTruthy()
  click(/^Todo realizado en Motor/)
  click(/^Listo · seguir con Frenos/)
  click(/^Todo realizado en Frenos/)
  click(/^Listo · cerrar Frenos/)
  expect(screen.getByText("Pauta completa.")).toBeTruthy()
  click("Continuar a fotos")

  for (const [label, name] of [["Filtros usados", "Filtros usados"], ["Sticker de mantención realizada", "Sticker de mantención realizada"]] as const) {
    fireEvent.change(screen.getByLabelText(`Tomar foto de ${label}`), { target: { files: [new File(["x"], "foto.jpg", { type: "image/jpeg" })] } })
    expect(await screen.findByRole("img", { name: `Foto: ${name}` })).toBeTruthy()
  }
  // «Revisar registro» queda habilitado: sin notas valida al tocarlo y dice qué falta.
  click("Revisar registro")
  expect(await screen.findByText("Escribe tus notas, o toca «Sin novedad» si no hay nada que anotar.")).toBeTruthy()
  expect(screen.getByText("PASO 4/5")).toBeTruthy()
  // El atajo llena el campo de un toque y sigue siendo editable.
  click("Sin novedad")
  expect(screen.getByLabelText(/^Notas/)).toHaveProperty("value", "Sin novedad")
  click("Revisar registro")
  expect(screen.getByText("Firmas como Javier Roa. Después de guardar no se puede editar.")).toBeTruthy()

  // «Cambiar» vuelve directo a Revisar.
  click("Cambiar notas")
  expect(await screen.findByText("PASO 4/5")).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/^Notas/), { target: { value: "Sin novedad. Sticker nuevo." } })
  click("Volver a revisar")
  expect(await screen.findByText("Sin novedad. Sticker nuevo.")).toBeTruthy()
  click("Firmar y guardar")
}

describe("App del mecánico (arranque, PIN, preventiva completa y envío)", () => {
  beforeEach(async () => {
    await freshDb()
    resetBootForTests()
    calls.length = 0
    vi.stubGlobal("crypto", webcrypto)
    Element.prototype.scrollTo = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
    URL.createObjectURL = vi.fn(() => "blob:foto")
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true })
    vi.unstubAllGlobals()
  })

  it("con señal: pide la credencial, define el PIN, hace la preventiva, la firma y llega con folio", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    expect(screen.getByText("Con señal")).toBeTruthy()
    expect(screen.getByText("Faena Biodiversa")).toBeTruthy()
    await signPreventive()

    expect(await screen.findByRole("heading", { name: "Registro guardado" })).toBeTruthy()
    expect(await screen.findByText("Ya llegó a la plataforma.", {}, { timeout: 5_000 })).toBeTruthy()
    expect(screen.getByText("MP-BIO-0042 · KA-140")).toBeTruthy()

    const sent = calls.filter((call) => call.url.includes("/sync/") && call.method !== "GET")
    expect(sent.filter((call) => call.method === "PUT")).toHaveLength(2)
    expect(sent.filter((call) => call.method === "POST")).toHaveLength(1)
    expect(new Set(sent.map((call) => call.auth))).toEqual(new Set(["Bearer token-u-1"]))
    // La credencial se pidió con la sesión (sin Bearer) y el catálogo con la credencial (nunca con la cookie).
    expect(calls.find((call) => call.url.endsWith("/api/mantencion/dispositivo"))?.auth).toBeNull()
    expect(calls.find((call) => call.url.endsWith("/sync/catalogo"))?.auth).toBe("Bearer token-u-1")

    click("Volver al inicio")
    expect(within(await screen.findByRole("region", { name: "Mis últimos registros" })).getByText("MP-BIO-0042")).toBeTruthy()
  })

  it("sin señal: se guarda en el teléfono con «Folio pendiente» y se envía solo cuando vuelve", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    // Se corta la señal con la app abierta (el catálogo ya está en el teléfono).
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true })
      window.dispatchEvent(new Event("offline"))
    })
    expect(await screen.findByText(/Sin señal · puedes registrar igual/)).toBeTruthy()
    await signPreventive()

    expect(await screen.findByRole("heading", { name: "Registro guardado" })).toBeTruthy()
    expect(await screen.findByText("Folio pendiente · KA-140")).toBeTruthy()
    expect(await screen.findByText(/Está guardado en el teléfono\. Se enviará solo/)).toBeTruthy()
    expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/sync/registros"))).toHaveLength(0)

    // Vuelve la señal: la cola se envía sola y la pantalla lo muestra.
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true })
      window.dispatchEvent(new Event("online"))
    })
    expect(await screen.findByText("Ya llegó a la plataforma.", {}, { timeout: 5_000 })).toBeTruthy()
    expect(screen.getByText("MP-BIO-0042 · KA-140")).toBeTruthy()
    await waitFor(() => expect(calls.filter((call) => call.method === "POST" && call.url.endsWith("/sync/registros"))).toHaveLength(1))
  })

  it("salir a medias guarda el avance y el inicio lo ofrece para seguir; descartar es una acción aparte", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    click(/^Mantención correctiva/)
    fireEvent.click(within(await screen.findByRole("group", { name: "Equipos" })).getByRole("button", { name: /KA-140/ }))
    click("Continuar con KA-140")
    expect(await screen.findByText("PASO 2/5")).toBeTruthy()

    // «Salir» está en la barra de arriba en cada paso (no sólo retrocediendo hasta el primero).
    click("Salir del registro")
    const dialog = await screen.findByRole("alertdialog", { name: "¿Salir del registro?" })
    expect(within(dialog).getByText(/Tu avance queda guardado en este teléfono/)).toBeTruthy()
    // Lo principal conserva el trabajo y es donde parte el foco; descartar es otra cosa, aparte.
    const save = within(dialog).getByRole("button", { name: "Guardar y salir" })
    expect(document.activeElement).toBe(save)
    expect(save.className).toContain("pri")
    expect(within(dialog).getByRole("button", { name: "Descartar registro" }).className).toContain("quiet-danger")
    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir registrando" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(screen.getByText("PASO 2/5")).toBeTruthy()

    click("Salir del registro")
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Guardar y salir" }))
    const drafts = await screen.findByRole("region", { name: "Registros sin terminar" })
    expect(within(drafts).getByText("Correctiva sin terminar · KA-140 · SGCP-84")).toBeTruthy()
    expect(within(drafts).getByText("Tu avance está guardado en este teléfono.")).toBeTruthy()

    // «Seguir» abre el borrador en el mismo paso.
    fireEvent.click(within(drafts).getByRole("button", { name: /^Seguir Correctiva sin terminar/ }))
    expect(await screen.findByText("PASO 2/5")).toBeTruthy()

    // Descartar sí lo borra, y sólo por elección explícita.
    click("Salir del registro")
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar registro" }))
    expect(await screen.findByRole("region", { name: "Nuevo registro" })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole("region", { name: "Registros sin terminar" })).toBeNull())
  })

  it("sin equipo elegido no hay nada que guardar: salir no pregunta", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    click(/^Mantención correctiva/)
    expect(await screen.findByRole("heading", { name: "¿Qué equipo vas a mantener?" })).toBeTruthy()
    click("Salir del registro")
    expect(await screen.findByRole("region", { name: "Nuevo registro" })).toBeTruthy()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("«Continuar» sin elegir equipo no se bloquea: avisa y deja el aviso arriba", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    click(/^Mantención preventiva/)
    expect(await screen.findByRole("heading", { name: "¿Qué equipo vas a mantener?" })).toBeTruthy()
    click("Continuar")
    expect(await screen.findByText("Elige un equipo.")).toBeTruthy()
    expect(screen.getByText("PASO 1/5")).toBeTruthy()
  })

  it("correctiva: las fotos tienen su propio paso, se exigen ahí y «Cambiar» vuelve a Revisar", async () => {
    installServer({ online: true })
    await openAndDefinePin()
    click(/^Mantención correctiva/)
    fireEvent.click(within(await screen.findByRole("group", { name: "Equipos" })).getByRole("button", { name: /KA-140/ }))
    click("Continuar con KA-140")
    expect(await screen.findByText("PASO 2/5")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Odómetro actual"), { target: { value: "40100" } })
    click("Continuar")

    // Paso 3 · Trabajo: sin el bloque de fotos.
    expect(await screen.findByText("PASO 3/5")).toBeTruthy()
    expect(screen.queryByLabelText("Agregar foto del trabajo")).toBeNull()
    fireEvent.click(within(screen.getByRole("group", { name: "Agregar trabajo" })).getAllByRole("button")[0]!)
    click("No se cambió aceite")
    fireEvent.change(screen.getByLabelText("Trabajo realizado"), { target: { value: "Cambio de manguera" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "No se usaron repuestos" }))
    fireEvent.change(screen.getByLabelText(/Conductores de las últimas 24 h/), { target: { value: "a" } })
    fireEvent.click(within(await screen.findByRole("group", { name: "Conductores encontrados" })).getAllByRole("button")[0]!)
    click("No, ya salió")
    click("Continuar a fotos")

    // Paso 4 · Fotos: se exige al menos una, con el aviso en el paso.
    expect(await screen.findByText("PASO 4/5")).toBeTruthy()
    click("Revisar registro")
    expect(await screen.findByText("Falta al menos una foto.")).toBeTruthy()
    expect(screen.getByText("PASO 4/5")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Agregar foto del trabajo"), { target: { files: [new File(["x"], "foto.jpg", { type: "image/jpeg" })] } })
    expect(await screen.findByRole("img", { name: "Foto 1 del trabajo" })).toBeTruthy()
    click("Revisar registro")

    // Paso 5 · Revisar: «Cambiar» en Fotos lleva al paso 4 y vuelve directo a Revisar.
    expect(await screen.findByText("PASO 5/5")).toBeTruthy()
    click("Cambiar fotos")
    expect(await screen.findByText("PASO 4/5")).toBeTruthy()
    click("Volver a revisar")
    expect(await screen.findByRole("button", { name: "Firmar y guardar" })).toBeTruthy()
  })

  it("con varias faenas el encabezado dice «3 faenas» y ofrece verlas; con una dice su nombre", async () => {
    const several = catalog("u-1", [equipment({ readings: [{ value: 39_900, date: "2026-10-01", source: "MP-BIO-0001" }], state: "proxima", remaining: 100, nextReading: 40_000 })])
    several.worksites = [{ id: "ws-bio", name: "Biodiversa" }, { id: "ws-min", name: "Mininco" }, { id: "ws-ara", name: "Arauco" }]
    several.user = { ...several.user, worksiteIds: ["ws-bio", "ws-min", "ws-ara"] }
    installServer({ online: true, catalog: several })
    await openAndDefinePin()
    const toggle = screen.getByRole("button", { name: "3 faenas" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("list")).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Biodiversa", "Mininco", "Arauco"])

    // El chip del paso «Equipo» también se resume: «Mis 3 faenas», no los tres nombres en tres líneas.
    click(/^Mantención correctiva/)
    expect(await screen.findByRole("button", { name: "Mis 3 faenas" })).toBeTruthy()
  })
})
