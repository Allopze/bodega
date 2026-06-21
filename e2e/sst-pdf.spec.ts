/**
 * E2E: SST PDF route — /sst/[id]/print/pdf
 *
 * Verifies that the server-side PDF generation route:
 *   • Responds 200 with Content-Type: application/pdf
 *   • Returns a non-empty body (actual PDF bytes)
 *   • Does NOT crash with MODULE_NOT_FOUND for playwright-core/browsers.json
 *     (regression guard for DEVOPS-03 in AUDITORIA_INTEGRAL_CHOME.md)
 *
 * Relies on the "sst-eval-e2e" fixture seeded by e2e/setup-db.ts.
 */
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.describe("SST PDF generation", () => {
  test("GET /sst/[id]/print/pdf returns a valid PDF", async ({ page, request }) => {
    // Authenticate — the route requires sst:view permission.
    await login(page)

    // Fetch the PDF directly via the API context so we can inspect headers
    // and body length without waiting for browser rendering.
    const response = await request.get("/sst/sst-eval-e2e/print/pdf", {
      headers: {
        // Forward the session cookies set during login.
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toMatch(/application\/pdf/)

    const body = await response.body()
    // PDF magic bytes: %PDF-
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")
    expect(body.byteLength).toBeGreaterThan(1000)
  })

  test("GET /sst/[id]/print/pdf returns 403 when not authenticated", async ({ request }) => {
    const response = await request.get("/sst/sst-eval-e2e/print/pdf")
    expect(response.status()).toBe(403)
  })

  test("GET /sst/[id]/print/pdf returns 404 for unknown evaluation id", async ({
    page,
    request,
  }) => {
    await login(page)
    const response = await request.get("/sst/nonexistent-id/print/pdf", {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })
    expect(response.status()).toBe(404)
  })
})
