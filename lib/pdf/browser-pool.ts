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
import type { Browser, BrowserContext } from "playwright"

const MAX_CONCURRENT = Number(process.env.PDF_MAX_CONCURRENT ?? "2")
const LAUNCH_TIMEOUT_MS = 30_000
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
  const configuredPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (configuredPath) return configuredPath
  return SYSTEM_CHROMIUM_PATHS.find((path) => existsSync(path))
}

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENT) {
      active++
      resolve()
    } else {
      waiters.push(() => {
        active++
        resolve()
      })
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
