import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("browser pool", () => {
  const disconnectListeners: DisconnectListener[] = []
  let mockBrowser: ReturnType<typeof makeMockBrowser>
  let launchMock: ReturnType<typeof vi.fn>

  // Re-import the module fresh for each test so module-level state is reset.
  let pool: typeof import("@/lib/pdf/browser-pool")

  beforeEach(async () => {
    disconnectListeners.length = 0
    mockBrowser = makeMockBrowser(disconnectListeners)
    launchMock = vi.fn(async () => mockBrowser)

    vi.doMock("playwright", () => ({
      chromium: { launch: launchMock },
    }))

    pool = await import("@/lib/pdf/browser-pool")
    pool._resetPoolForTesting()
  })

  afterEach(() => {
    vi.doUnmock("playwright")
    vi.resetModules()
  })

  describe("browser lifecycle", () => {
    it("launches the browser lazily on first use", async () => {
      expect(launchMock).not.toHaveBeenCalled()

      await pool.withBrowserContext({}, async () => "ok")

      expect(launchMock).toHaveBeenCalledOnce()
    })

    it("reuses the same browser for multiple sequential requests", async () => {
      await pool.withBrowserContext({}, async () => "first")
      await pool.withBrowserContext({}, async () => "second")

      expect(launchMock).toHaveBeenCalledOnce()
    })

    it("re-launches the browser after a disconnected event", async () => {
      await pool.withBrowserContext({}, async () => "first")
      expect(launchMock).toHaveBeenCalledOnce()

      // Simulate browser crash
      for (const cb of disconnectListeners) cb()

      await pool.withBrowserContext({}, async () => "second")
      expect(launchMock).toHaveBeenCalledTimes(2)
    })

    it("creates an isolated context per request", async () => {
      await pool.withBrowserContext({}, async () => "a")
      await pool.withBrowserContext({}, async () => "b")

      expect(mockBrowser.newContext).toHaveBeenCalledTimes(2)
    })

    it("closes the context after fn resolves", async () => {
      let ctx: { close: ReturnType<typeof vi.fn> } | null = null
      await pool.withBrowserContext({}, async (c) => {
        ctx = c as unknown as typeof ctx
      })

      expect(ctx!.close).toHaveBeenCalledOnce()
    })

    it("closes the context even when fn rejects", async () => {
      let ctx: { close: ReturnType<typeof vi.fn> } | null = null
      await expect(
        pool.withBrowserContext({}, async (c) => {
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

      // Start 2 calls that each hold the slot while an inner promise is pending.
      let releaseFirst!: () => void
      let releaseSecond!: () => void
      const first = pool.withBrowserContext({}, async () => {
        order.push(1)
        await new Promise<void>((r) => { releaseFirst = r })
        return "first"
      })
      const second = pool.withBrowserContext({}, async () => {
        order.push(2)
        await new Promise<void>((r) => { releaseSecond = r })
        return "second"
      })

      // Give both calls a tick to start.
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

      const first = pool.withBrowserContext({}, async () => {
        order.push("start-1")
        await new Promise<void>((r) => { releaseFirst = r })
        order.push("end-1")
        return "first"
      })
      const second = pool.withBrowserContext({}, async () => {
        order.push("start-2")
        await new Promise<void>((r) => { releaseSecond = r })
        order.push("end-2")
        return "second"
      })

      // Allow both to start
      await delay(10)
      expect(order).toEqual(["start-1", "start-2"])

      // Third call should queue — it can't start yet
      const third = pool.withBrowserContext({}, async () => {
        order.push("start-3")
        return "third"
      })

      await delay(10)
      expect(order).not.toContain("start-3") // Still queued

      // Release first slot
      releaseFirst()
      await delay(10)
      expect(order).toContain("start-3") // Now running
      expect(order).toContain("end-1")

      releaseSecond()
      await Promise.all([first, second, third])
    })

    it("releases a slot even when fn throws, unblocking queued requests", async () => {
      const completed: string[] = []

      let releaseSlot!: () => void

      // Fill both slots
      const first = pool.withBrowserContext({}, async () => {
        await new Promise<void>((r) => { releaseSlot = r })
        completed.push("first")
      })
      // Wrap in expect().rejects immediately so Node never sees an unhandled rejection.
      const secondSettled = expect(
        pool.withBrowserContext({}, () => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom")

      // Allow both to start
      await delay(10)

      // Third is queued
      const third = pool.withBrowserContext({}, async () => {
        completed.push("third")
      })

      // second should reject immediately; first is still blocking slot 1
      await secondSettled
      await delay(10)
      expect(completed).toContain("third") // slot 2 was freed by the rejection

      releaseSlot()
      await Promise.all([first, third])
      expect(completed).toContain("first")
    })
  })

  describe("context options", () => {
    it("passes extraHTTPHeaders to newContext", async () => {
      const headers = { cookie: "session=abc123" }
      await pool.withBrowserContext({ extraHTTPHeaders: headers }, async () => "ok")

      expect(mockBrowser.newContext).toHaveBeenCalledWith({ extraHTTPHeaders: headers })
    })

    it("passes empty options to newContext when no headers provided", async () => {
      await pool.withBrowserContext({}, async () => "ok")

      expect(mockBrowser.newContext).toHaveBeenCalledWith({})
    })
  })
})
