import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `public/mant-sw.js` no es un módulo: se carga en un contexto aislado con un `self`, un `caches` y un
 * `fetch` falsos, y se dispara su evento `fetch` como lo haría el navegador (APP-7).
 */

const SOURCE = readFileSync(join(process.cwd(), "public/mant-sw.js"), "utf8")
const ORIGIN = "https://plataforma.test"
const APP = `${ORIGIN}/m/mantencion`
const LOGIN = `${ORIGIN}/m/mantencion/entrar`

type Handler = (event: unknown) => void
const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init })

function loadWorker(fetchImpl: (input: unknown) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>()
  const key = (request: unknown) => new URL(typeof request === "string" ? request : (request as { url: string }).url, ORIGIN).pathname
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, store)
    return {
      match: async (request: unknown) => store.get(key(request))?.clone(),
      put: async (request: unknown, response: Response) => { store.set(key(request), response) },
      keys: async () => [...store.keys()],
      delete: async (request: unknown) => store.delete(key(request)),
    }
  }
  const handlers: Record<string, Handler> = {}
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => { handlers[type] = handler },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
  }
  runInNewContext(SOURCE, {
    self, caches: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) },
    fetch: fetchImpl, URL, Response, Request, Promise, setTimeout, clearTimeout, Symbol, console,
  })
  const navigate = async (url: string) => {
    let responded: Promise<Response> | null = null
    const waits: Promise<unknown>[] = []
    handlers.fetch!({
      request: { method: "GET", mode: "navigate", url },
      respondWith: (promise: Promise<Response>) => { responded = promise },
      waitUntil: (promise: Promise<unknown>) => { waits.push(promise) },
    })
    return { response: responded as unknown as Promise<Response>, waits }
  }
  const shell = async () => (await (await open("mant-shell-v2")).match(APP))?.text()
  return { navigate, shell, seedShell: async (body: string) => (await open("mant-shell-v2")).put(APP, html(body)) }
}

describe("service worker: navegación a la app con tiempo máximo (APP-7)", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("con red sana entrega el HTML de la red y lo deja guardado", async () => {
    const worker = loadWorker(async () => html("de la red"))
    const { response } = await worker.navigate(APP)
    expect(await (await response).text()).toBe("de la red")
    expect(await worker.shell()).toBe("de la red")
  })

  it("wifi sin salida (el fetch se cuelga): a los 4,5 s abre el shell guardado y no se queda en blanco", async () => {
    const worker = loadWorker(() => new Promise<Response>(() => undefined))
    await worker.seedShell("guardado")
    const { response } = await worker.navigate(APP)
    let settled = false
    void response.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(4_400)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await (await response).text()).toBe("guardado")
  })

  it("si vence el tiempo pero la red contesta después, el HTML nuevo queda guardado para la próxima", async () => {
    let release: (response: Response) => void = () => undefined
    const worker = loadWorker(() => new Promise<Response>((resolve) => { release = resolve }))
    await worker.seedShell("viejo")
    const { response, waits } = await worker.navigate(APP)
    await vi.advanceTimersByTimeAsync(4_600)
    expect(await (await response).text()).toBe("viejo")
    release(html("nuevo"))
    await Promise.all(waits)
    expect(await worker.shell()).toBe("nuevo")
  })

  it("sin shell guardado no hay nada mejor: sigue esperando a la red y entrega su respuesta", async () => {
    let release: (response: Response) => void = () => undefined
    const worker = loadWorker(() => new Promise<Response>((resolve) => { release = resolve }))
    const { response } = await worker.navigate(APP)
    await vi.advanceTimersByTimeAsync(10_000)
    release(html("tarde"))
    expect(await (await response).text()).toBe("tarde")
  })

  it("sin shell guardado y la red cae: responde el 503 de siempre", async () => {
    const worker = loadWorker(async () => { throw new TypeError("net") })
    const { response } = await worker.navigate(APP)
    expect((await response).status).toBe(503)
  })

  it("con un 5xx del servidor abre el shell guardado, como antes", async () => {
    const worker = loadWorker(async () => new Response("caído", { status: 502 }))
    await worker.seedShell("guardado")
    const { response } = await worker.navigate(APP)
    expect(await (await response).text()).toBe("guardado")
  })

  it("el login NO tiene tiempo máximo ni recibe el shell: espera a la red", async () => {
    let release: (response: Response) => void = () => undefined
    const worker = loadWorker(() => new Promise<Response>((resolve) => { release = resolve }))
    await worker.seedShell("sesión anterior")
    const { response } = await worker.navigate(LOGIN)
    let settled = false
    void response.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false)
    release(html("login"))
    expect(await (await response).text()).toBe("login")
  })

  it("el login sin red no recibe el shell guardado: 503", async () => {
    const worker = loadWorker(async () => { throw new TypeError("net") })
    await worker.seedShell("sesión anterior")
    const { response } = await worker.navigate(LOGIN)
    const result = await response
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("sesión anterior")
  })
})
