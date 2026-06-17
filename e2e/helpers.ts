import { expect, type Page } from "@playwright/test"

/** Log in as the E2E admin user and verify we land on dashboard. */
export async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

/** Select an option inside a Radix Select identified by `id`. */
export async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).first().click()
}
