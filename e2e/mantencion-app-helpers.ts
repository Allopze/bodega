import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { clearRateLimits } from "./helpers"

/**
 * Ayudas de la app del mecánico (`/m/mantencion`) compartidas por
 * `mantencion-1-app.spec.ts` y `mantencion-5-ot.spec.ts`. No es un `*.spec.ts`:
 * Playwright no lo ejecuta, y importar un spec desde otro registraría sus
 * pruebas dos veces.
 */

export async function nuevoContexto(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3100"
  return browser.newContext({ baseURL, viewport, hasTouch: true, serviceWorkers: "allow" })
}

/** Entra por el login PROPIO de la app (no el de la plataforma), como al abrirla instalada o con «Entrar con otra cuenta». */
export async function entrar(page: Page, email: string) {
  await clearRateLimits()
  if (!/\/m\/mantencion\/entrar/.test(page.url())) await page.goto("/m/mantencion/entrar")
  await page.getByLabel("Correo", { exact: true }).fill(email)
  await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await expect(page).toHaveURL(/\/m\/mantencion$/, { timeout: 30_000 })
}

export async function teclearPin(page: Page, pin: string) {
  const teclado = page.getByRole("group", { name: "Teclado numérico" })
  for (const digito of pin) await teclado.getByRole("button", { name: digito, exact: true }).click()
}

export async function definirPin(page: Page, pin: string) {
  await expect(page.getByRole("heading", { name: "Define tu PIN" })).toBeVisible({ timeout: 30_000 })
  await teclearPin(page, pin)
  await expect(page.getByRole("heading", { name: "Repite tu PIN" })).toBeVisible()
  await teclearPin(page, pin)
  // El saludo también está en la pantalla del PIN: el inicio se reconoce por «Nuevo registro».
  await expect(page.getByRole("region", { name: "Nuevo registro" })).toBeVisible({ timeout: 30_000 })
}

/** JPEG pequeño y válido, generado en memoria en el propio navegador (sin archivos ni dependencias). */
export async function jpeg(page: Page, rotulo: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const base64 = await page.evaluate((texto) => {
    const lienzo = document.createElement("canvas")
    lienzo.width = 640
    lienzo.height = 480
    const contexto = lienzo.getContext("2d")
    if (!contexto) return ""
    contexto.fillStyle = "#cfd6d2"
    contexto.fillRect(0, 0, 640, 480)
    contexto.fillStyle = "#1d1d1b"
    contexto.font = "32px sans-serif"
    contexto.fillText(texto, 30, 80)
    return lienzo.toDataURL("image/jpeg", 0.8).split(",")[1] ?? ""
  }, rotulo)
  return { name: `${rotulo.replace(/\W+/g, "-")}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") }
}

/** Última lectura que muestra el paso «Lectura» (número sin puntos). */
export async function ultimaLectura(page: Page): Promise<number> {
  const texto = await page.getByText(/Última lectura registrada: [\d.]+ (km|h)/).innerText()
  return Number(/registrada: ([\d.]+)/.exec(texto)?.[1]?.replace(/\./g, "") ?? "0")
}

export const campoLectura = (page: Page) => page.getByLabel(/Odómetro actual|Horómetro actual/)

