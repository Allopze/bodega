import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Playwright mock ───────────────────────────────────────────────────────────

type DisconnectListener = () => void

function makeMockBrowser(disconnectListeners: DisconnectListener[]) {
  const browser = {
    isConnected: vi.fn(() => true),
    newContext: vi.fn(async () => makeContext()),
    on: vi.fn((event: string, cb: DisconnectListener) => {
      if (event === "disconnected") disconnectListeners.push(cb)
    }),
  }
  return browser
}

function makeContext() {
  return {
    newPage: vi.fn(async () => ({
      goto: vi.fn(async () => undefined),
      pdf: vi.fn(async () => Buffer.from("%PDF-fake")),
    })),
    close: vi.fn(async () => undefined),
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ── Shared mock state ─────────────────────────────────────────────────────────

const disconnectListeners: DisconnectListener[] = []
let mockBrowser: ReturnType<typeof makeMockBrowser>

// Force the default concurrency limit of 2 for testing (must run BEFORE the module is imported)
vi.hoisted(() => {
  process.env.PDF_MAX_CONCURRENT = "2"
})

const mockLaunch = vi.fn()
vi.mock("playwright", () => ({
  chromium: { launch: mockLaunch },
}))

import * as poolModule from "@/lib/pdf/browser-pool"

beforeEach(() => {
  disconnectListeners.length = 0
  mockBrowser = makeMockBrowser(disconnectListeners)
  mockLaunch.mockReset()
  delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockLaunch.mockResolvedValue(mockBrowser as any)
  poolModule._resetPoolForTesting()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("browser pool", () => {
  describe("browser lifecycle", () => {
    it("launches the browser lazily on first use", async () => {
      expect(mockLaunch).not.toHaveBeenCalled()
      await poolModule.withBrowserContext({}, async () => "ok")
      expect(mockLaunch).toHaveBeenCalledOnce()
    })

    it("uses the runtime Chromium executable when configured", async () => {
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium-browser"
      await poolModule.withBrowserContext({}, async () => "ok")
      expect(mockLaunch).toHaveBeenCalledWith({
        timeout: 30_000,
        executablePath: "/usr/bin/chromium-browser",
      })
    })

    it("reuses the same browser for multiple sequential requests", async () => {
      await poolModule.withBrowserContext({}, async () => "first")
      await poolModule.withBrowserContext({}, async () => "second")
      expect(mockLaunch).toHaveBeenCalledOnce()
    })

    it("re-launches the browser after a disconnected event", async () => {
      await poolModule.withBrowserContext({}, async () => "first")
      expect(mockLaunch).toHaveBeenCalledOnce()

      for (const cb of disconnectListeners) cb()

      await poolModule.withBrowserContext({}, async () => "second")
      expect(mockLaunch).toHaveBeenCalledTimes(2)
    })

    it("creates an isolated context per request", async () => {
      await poolModule.withBrowserContext({}, async () => "a")
      await poolModule.withBrowserContext({}, async () => "b")
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2)
    })

    it("closes the context after fn resolves", async () => {
      let ctx: { close: ReturnType<typeof vi.fn> } | null = null
      await poolModule.withBrowserContext({}, async (c) => {
        ctx = c as unknown as typeof ctx
      })
      expect(ctx!.close).toHaveBeenCalledOnce()
    })

    it("closes the context even when fn rejects", async () => {
      let ctx: { close: ReturnType<typeof vi.fn> } | null = null
      await expect(
        poolModule.withBrowserContext({}, async (c) => {
          ctx = c as unknown as typeof ctx
          throw new Error("render failed")
        }),
      ).rejects.toThrow("render failed")
      expect(ctx!.close).toHaveBeenCalledOnce()
    })
  })

  describe("concurrency limiting", () => {
    it("allows up to PDF_MAX_CONCURRENT (2) simultaneous contexts", async () => {
      const order: number[] = []

      let releaseFirst!: () => void
      let releaseSecond!: () => void
      const first = poolModule.withBrowserContext({}, async () => {
        order.push(1)
        await new Promise<void>((r) => { releaseFirst = r })
        return "first"
      })
      const second = poolModule.withBrowserContext({}, async () => {
        order.push(2)
        await new Promise<void>((r) => { releaseSecond = r })
        return "second"
      })

      await delay(10)
      expect(order).toEqual([1, 2])

      releaseFirst()
      releaseSecond()
      await Promise.all([first, second])
    })

    it("queues the third request until a slot frees", async () => {
      const order: string[] = []

      let releaseFirst!: () => void
      let releaseSecond!: () => void

      const first = poolModule.withBrowserContext({}, async () => {
        order.push("start-1")
        await new Promise<void>((r) => { releaseFirst = r })
        order.push("end-1")
        return "first"
      })
      const second = poolModule.withBrowserContext({}, async () => {
        order.push("start-2")
        await new Promise<void>((r) => { releaseSecond = r })
        order.push("end-2")
        return "second"
      })

      await delay(10)
      expect(order).toEqual(["start-1", "start-2"])

      // Before creating third, confirm exactly 2 slots are taken
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2)

      const third = poolModule.withBrowserContext({}, async () => {
        order.push("start-3")
        return "third"
      })

      // After creating third, it should be queued — no new context created
      await delay(10)
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2)
      expect(order).not.toContain("start-3")

      releaseFirst()
      await delay(10)
      expect(order).toContain("start-3")
      expect(order).toContain("end-1")

      releaseSecond()
      await Promise.all([first, second, third])
    })

    it("releases a slot even when fn throws, unblocking queued requests", async () => {
      const completed: string[] = []

      let releaseSlot!: () => void

      const first = poolModule.withBrowserContext({}, async () => {
        await new Promise<void>((r) => { releaseSlot = r })
        completed.push("first")
      })
      const secondSettled = expect(
        poolModule.withBrowserContext({}, () => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom")

      await delay(10)

      const third = poolModule.withBrowserContext({}, async () => {
        completed.push("third")
      })

      await secondSettled
      await delay(10)
      expect(completed).toContain("third")

      releaseSlot()
      await Promise.all([first, third])
      expect(completed).toContain("first")
    })
  })

  describe("context options", () => {
    it("passes extraHTTPHeaders to newContext", async () => {
      const headers = { cookie: "session=abc123" }
      await poolModule.withBrowserContext({ extraHTTPHeaders: headers }, async () => "ok")
      expect(mockBrowser.newContext).toHaveBeenCalledWith({ extraHTTPHeaders: headers })
    })

    it("passes empty options to newContext when no headers provided", async () => {
      await poolModule.withBrowserContext({}, async () => "ok")
      expect(mockBrowser.newContext).toHaveBeenCalledWith({})
    })
  })
})
