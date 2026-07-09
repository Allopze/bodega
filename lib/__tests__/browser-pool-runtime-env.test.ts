import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("browser pool runtime env access", () => {
  it("does not read PDF runtime env vars through direct process.env properties", async () => {
    const source = await readFile(path.join(process.cwd(), "lib/pdf/browser-pool.ts"), "utf8")

    expect(source).not.toContain("process.env.PDF_MAX_CONCURRENT")
    expect(source).not.toContain("process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
  })
})
