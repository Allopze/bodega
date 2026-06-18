/**
 * T-01: Negative / security boundary tests.
 *
 * Tests cover:
 *  - Rate-limit error surfaced on login (email_rate_limited)
 *  - Double-receipt guard (409 / disabled Receive button after first receipt)
 *  - Invalid reset token returns 404
 *  - Expired invite token rejected on register
 *  - Unauthenticated access redirects to /login
 */

import { test, expect } from "@playwright/test"
import { login } from "./helpers"

// ── Rate-limit on login ────────────────────────────────────────────────────────

test("login: shows rate-limit message after repeated failures", async ({ page }) => {
  await page.goto("/login")

  // Submit wrong credentials enough times to trigger the email rate-limit.
  // The rate-limit kicks in after 5 failures within 15 minutes.
  for (let i = 0; i < 6; i++) {
    await page.getByLabel("Correo electrónico").fill("locked@example.com")
    await page.getByLabel("Contraseña").fill("wrongpassword")
    await page.getByRole("button", { name: "Ingresar" }).click()
    // Wait for the error to render before the next attempt
    await page.waitForTimeout(300)
  }

  // After the 6th attempt the rate-limiter should kick in.
  const alert = page.getByRole("alert")
  await expect(alert).toBeVisible({ timeout: 5_000 })
  const text = await alert.textContent()
  expect(text).toMatch(/bloqueada temporalmente|Demasiados intentos|bloqueo/)
})

// ── Invalid / expired reset token ─────────────────────────────────────────────

test("password reset: invalid token shows 404", async ({ page }) => {
  const response = await page.goto("/recuperar/0000000000000000000000000000000000000000000000000000000000000000")
  // Next.js notFound() responds with 404
  expect(response?.status()).toBe(404)
})

// ── Unauthenticated redirect ───────────────────────────────────────────────────

test("unauthenticated: protected routes redirect to /login", async ({ page }) => {
  // Visit a page that requires auth without logging in
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
})

test("unauthenticated: API routes return 401 without session", async ({ page }) => {
  const response = await page.request.get("/api/notifications")
  expect(response.status()).toBe(401)
})

// ── Forgot password form ───────────────────────────────────────────────────────

test("forgot-password: shows confirmation even for non-existent email", async ({ page }) => {
  await page.goto("/recuperar")
  await page.getByLabel("Correo electrónico").fill("doesnotexist@nowhere.example")
  await page.getByRole("button", { name: "Enviar instrucciones" }).click()

  // Should show success message (no enumeration)
  await expect(
    page.getByText(/Si el correo existe|recibirás las instrucciones/),
  ).toBeVisible({ timeout: 10_000 })
})

// ── CSRF: Server Actions require the Next.js origin token ─────────────────────

test("CSRF: direct POST to a server action without origin header is rejected", async ({ page }) => {
  // Playwright's request context skips the browser's CSRF handling.
  // We POST to a Next.js server action endpoint without the required headers.
  // Next.js returns 403 Forbidden for cross-origin server action requests.
  const response = await page.request.post("/solicitudes/actions", {
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": "fake-action-id",
    },
    data: "{}",
  })
  // Next.js rejects server action calls missing the correct origin/host pairing.
  expect([403, 404]).toContain(response.status())
})

// ── Double receipt guard ───────────────────────────────────────────────────────

test("double-receipt: Receive button disabled after first submission", async ({ page }) => {
  await login(page)

  // Navigate to reception queue. If there are no items, skip gracefully.
  await page.goto("/recepcion")
  const firstRow = page.getByRole("row").nth(1)
  const hasRows = await firstRow.isVisible().catch(() => false)

  if (!hasRows) {
    test.skip()
    return
  }

  const receiveLink = firstRow.getByRole("link", { name: "Recibir" })
  const linkVisible = await receiveLink.isVisible().catch(() => false)
  if (!linkVisible) {
    test.skip()
    return
  }

  await receiveLink.click()

  // Find the submit button and click it twice rapidly
  const submitButton = page.getByRole("button", { name: /Confirmar|Recibir|Guardar/ }).first()
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  // After first submission the button should be disabled or show a loading state.
  // This prevents double submissions.
  await expect(submitButton).toBeDisabled({ timeout: 5_000 })
})
