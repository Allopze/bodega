import { expect, test, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { clearRateLimits } from "./helpers"


test("exportes: genera Excel parseable con volumen operativo alto", async ({ page }) => {
  await login(page)

  const response = await page.request.get("/api/reportes/export?tipo=items_sin_oc")
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet")
  expect(response.headers()["content-disposition"]).toContain("items-sin-oc.xlsx")

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.body()) as never)

  const worksheet = workbook.getWorksheet("Items sin OC")
  expect(worksheet).toBeDefined()
  expect(worksheet?.getRow(1).values).toEqual([
    undefined,
    "Producto",
    "SKU",
    "Faena",
    "Solicitud",
    "Cantidad",
    "U/M",
    "Estado",
    "Fecha creación",
  ])
  expect(worksheet?.rowCount).toBeGreaterThanOrEqual(121)
  expect(worksheet?.getColumn(4).values.join(" ")).toContain("SOL-BULK-E2E-001")
})

async function login(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

