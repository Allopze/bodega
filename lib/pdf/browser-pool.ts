/**
 * Singleton Playwright browser pool.
 *
 * Keeps one persistent Browser instance per Node.js process. Concurrent PDF
 * requests each get their own BrowserContext (isolated cookies/cache), but the
 * number of live contexts at any moment is capped at PDF_MAX_CONCURRENT (default
 * 2). A request that arrives when the cap is reached waits in a FIFO queue
 * rather than spawning a new Chromium process — preventing OOM under burst load.
 *
 * The browser is created lazily on first use. If it crashes (disconnected event)
 * the slot is cleared so the next request triggers a fresh launch.
 */

import { existsSync } from "node:fs"
import type { Browser, BrowserContext, BrowserServer, Page } from "playwright"

function readRuntimeEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

const MAX_CONCURRENT = Number(readRuntimeEnv("PDF_MAX_CONCURRENT") ?? "2")
const LAUNCH_TIMEOUT_MS = 30_000
const NEW_PAGE_TIMEOUT_MS = 30_000
const CONTEXT_CLOSE_TIMEOUT_MS = 5_000
const SYSTEM_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
]

// Promise-lock prevents parallel launch races when multiple requests arrive
// before the browser is ready.
let launchPromise: Promise<Browser> | null = null

// Simple semaphore tracking live context count + overflow waiters.
let active = 0
const waiters: Array<() => void> = []

function resolveChromiumExecutablePath(): string | undefined {
  const configuredPath = readRuntimeEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
  if (configuredPath && existsSync(configuredPath)) return configuredPath
  // Una ruta configurada que no existe hacía fallar todo PDF con «executable doesn't
  // exist». Se avisa y se sigue con los Chromium del sistema o, sin ninguno, con el
  // que trae Playwright (undefined).
  if (configuredPath) console.warn(`[pdf] PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH apunta a un archivo inexistente (${configuredPath}); se usa otro Chromium.`)
  return SYSTEM_CHROMIUM_PATHS.find((path) => existsSync(path))
}

function acquire(timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (active < MAX_CONCURRENT) {
      active++
      resolve()
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const onAvailable = () => {
      if (timeoutId) clearTimeout(timeoutId)
      active++
      resolve()
    }
    waiters.push(onAvailable)
    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        const index = waiters.indexOf(onAvailable)
        if (index < 0) return
        waiters.splice(index, 1)
        reject(new Error("El navegador está ocupado. No fue posible iniciar la consulta de Copec."))
      }, timeoutMs)
    }
  })
}

function release(): void {
  active--
  const next = waiters.shift()
  if (next) next()
}

async function getBrowser(): Promise<Browser> {
  if (!launchPromise) {
    launchPromise = (async () => {
      // Lazy import keeps playwright-core out of the module graph at startup.
      const { chromium } = await import("playwright")
      const executablePath = resolveChromiumExecutablePath()
      const b = await chromium.launch({
        timeout: LAUNCH_TIMEOUT_MS,
        ...(executablePath ? { executablePath } : {}),
      })
      b.on("disconnected", () => {
        launchPromise = null
      })
      return b
    })().catch((err) => {
      launchPromise = null
      throw err
    })
  }
  return launchPromise
}

export type BrowserContextOptions = Parameters<Browser["newContext"]>[0]

/** Playwright no aplica el timeout de navegación a newPage ni a newContext. */
async function withDeadline<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export function openBrowserPage(context: BrowserContext, timeoutMessage: string): Promise<Page> {
  return withDeadline(context.newPage(), NEW_PAGE_TIMEOUT_MS, timeoutMessage)
}

/** No devuelve el turno hasta confirmar que el proceso aislado terminó. */
async function stopIsolatedBrowser(server: BrowserServer): Promise<void> {
  try {
    await server.kill()
  } catch {
    // Si Playwright no pudo cerrar, pedir la terminación directa y esperar el
    // evento del proceso. Liberar el lock antes dejaría dos importadores activos.
    const child = server.process()
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const onExit = () => { child.off("error", onError); resolve() }
      const onError = () => {} // Conservar el turno hasta que el proceso termine.
      child.once("exit", onExit)
      child.once("error", onError)
      if (child.exitCode !== null || child.signalCode !== null) {
        child.off("exit", onExit)
        onExit()
        return
      }
      try { child.kill("SIGKILL") } catch { /* Esperar el fin por otra vía. */ }
    })
  }
}

/**
 * Copec usa un proceso propio: si Chromium deja de responder durante la
 * apertura o el cierre del contexto podemos detenerlo sin afectar los PDF.
 * El callback debe terminar antes de iniciar la limpieza; nunca se abandona
 * una importación que pueda seguir escribiendo en segundo plano.
 */
export async function withIsolatedBrowserContext<T>(
  contextOptions: BrowserContextOptions,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  await acquire(LAUNCH_TIMEOUT_MS)
  let server: BrowserServer | undefined
  let ctx: BrowserContext | undefined
  try {
    const { chromium } = await import("playwright")
    const executablePath = resolveChromiumExecutablePath()
    server = await chromium.launchServer({
      host: "127.0.0.1",
      timeout: LAUNCH_TIMEOUT_MS,
      ...(executablePath ? { executablePath } : {}),
    })
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: LAUNCH_TIMEOUT_MS })
    ctx = await withDeadline(browser.newContext(contextOptions), LAUNCH_TIMEOUT_MS, "No fue posible preparar el navegador de Copec.")
    return await fn(ctx)
  } finally {
    if (ctx) {
      await withDeadline(ctx.close(), CONTEXT_CLOSE_TIMEOUT_MS, "No fue posible cerrar el navegador de Copec.").catch(() => undefined)
    }
    if (server) await stopIsolatedBrowser(server)
    release()
  }
}

/**
 * Runs `fn` inside a fresh BrowserContext. The context is closed when `fn`
 * resolves or rejects. Waits for a slot if MAX_CONCURRENT is already reached.
 */
export async function withBrowserContext<T>(
  contextOptions: BrowserContextOptions,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  await acquire()
  let ctx: BrowserContext | null = null
  try {
    const browser = await getBrowser()
    ctx = await browser.newContext(contextOptions)
    return await fn(ctx)
  } finally {
    if (ctx) {
      // Ignore close errors — context may already be gone if browser crashed.
      await ctx.close().catch(() => undefined)
    }
    release()
  }
}

/** Exposed only for unit tests — resets pool state between test cases. */
export function _resetPoolForTesting(): void {
  launchPromise = null
  active = 0
  waiters.length = 0
}
