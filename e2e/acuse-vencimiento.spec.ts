import { expect, test } from "@playwright/test"
import { preventionAckPathWithExpiry } from "./helpers"

/**
 * PREV-M06 (2026-09-27): el enlace público de acuse vence por tiempo. La
 * página debe decir que venció —para que el trabajador pida otro— y eso debe
 * ser distinto de un enlace falso, que sigue respondiendo 404.
 *
 * El destino no existe a propósito: "vencido" se decide sólo con la firma, así
 * que la respuesta no puede depender de si el integrante existe (no es un
 * oráculo de ids).
 */
test.use({ storageState: { cookies: [], origins: [] } })

const TARGET = "crew-inexistente-m06"

test("un enlace vencido dice que venció, sin sesión y sin revelar el destino", async ({ page }) => {
  const haceUnMes = Math.floor(Date.now() / 1000) - 30 * 86_400
  const response = await page.goto(preventionAckPathWithExpiry(TARGET, haceUnMes))
  expect(response?.status()).toBe(200)
  await expect(page.getByRole("heading", { name: "Enlace vencido" })).toBeVisible()
  await expect(page.getByRole("status")).toHaveText("El enlace venció; pide uno nuevo a tu supervisor.")
  await expect(page.getByRole("button", { name: /acus/i })).toHaveCount(0)
})

test("un enlace con el vencimiento alterado es inválido (404), no vencido", async ({ page }) => {
  const vigente = preventionAckPathWithExpiry(TARGET, Math.floor(Date.now() / 1000) + 86_400)
  const alterado = vigente.replace(/\/v2\.(\d+)\./, (_, exp: string) => `/v2.${Number(exp) - 60 * 86_400}.`)
  const response = await page.goto(alterado)
  expect(response?.status()).toBe(404)
  await expect(page.getByText("El enlace venció")).toHaveCount(0)
})

test("un enlace vigente para un destino inexistente responde 404 igual que uno falso", async ({ page }) => {
  const response = await page.goto(preventionAckPathWithExpiry(TARGET, Math.floor(Date.now() / 1000) + 86_400))
  expect(response?.status()).toBe(404)
})
