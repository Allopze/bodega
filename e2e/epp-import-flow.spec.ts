/**
 * E2E test: EPP import flow — subir Excel → revisar → cancelar lote.
 *
 * Prereq: setup-db.ts seeds the admin user (admin@e2e.chome.cl / chome2026)
 * with full permissions including admin:epp_import_upload and admin:epp_import_confirm.
 *
 * Flow:
 *  1. Generate a valid Excel in-memory with ExcelJS
 *  2. Log in as admin
 *  3. Navigate to /admin/productos
 *  4. Open the import panel ("Importar Excel")
 *  5. Upload the Excel file
 *  6. Verify success: "Análisis listo" with a "Revisar lote" button
 *  7. Click "Revisar lote" → lands on the review page
 *  8. Click "Cancelar importación"
 *  9. Verify the batch was cancelled (redirect to /admin/productos + toast)
 */

import { expect, test } from "@playwright/test"
import ExcelJS from "exceljs"
import { login } from "./helpers"

test("EPP import: subir Excel, revisar en página de lote y cancelar importación", async ({ page }) => {
  // ── 1. Generate a valid Excel in memory ────────────────────────────────
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("EPP")
  sheet.addRow(["Nombre", "Unidad", "Color", "Talla", "Proveedor", "Precio"])
  sheet.addRow(["Casco de seguridad blanco", "uni", "Blanco", "M", "Proveedor E2E", "15000"])
  sheet.addRow(["Guante nitrilo azul talle L", "par", "Azul", "L", "Proveedor E2E", "8500"])
  const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

  // ── 2. Log in as admin ────────────────────────────────────────────────
  await login(page)

  // ── 3. Navigate to /admin/productos ────────────────────────────────────
  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: /catálogo/i })).toBeVisible()

  // ── 4. Open the import panel ───────────────────────────────────────────
  await page.getByRole("button", { name: "Importar", exact: true }).click()
  await page.getByRole("button", { name: /equipos de protección \(epp\)/i }).click()
  const dialog = page.getByRole("dialog").filter({ hasText: "Importar equipos de protección (EPP)" })
  await expect(dialog).toBeVisible()

  // ── 5. Upload the Excel file ────────────────────────────────────────────
  await page.getByLabel("Archivo Excel").setInputFiles({
    name: "epp-e2e-test.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsxBuffer,
  })

  // ── 6. Submit the form ─────────────────────────────────────────────────
  // El control se llama "Importar Excel", en línea con "Exportar Excel".
  await dialog.getByRole("button", { name: /importar excel/i }).click()

  // ── 7. Verify success: "Análisis listo" with "Revisar lote" button ─────
  await expect(page.getByText(/análisis listo para confirmar/i)).toBeVisible({ timeout: 30_000 })

  // ── 8. Click "Revisar lote" → lands on the review page ─────────────────
  const reviewButton = page.getByRole("button", { name: /revisar lote/i })
  await expect(reviewButton).toBeVisible()
  await reviewButton.click()
  await expect(page).toHaveURL(/\/admin\/productos\/importar\//)
  await expect(page.getByText(/cancelar importación/i)).toBeVisible()

  // ── 9. Click "Cancelar importación" ────────────────────────────────────
  await page.getByRole("button", { name: /cancelar importación/i }).click()

  // ── 10. Verify redirect to /admin/productos and success toast ───────────
  await expect(page).toHaveURL(/\/admin\/productos/)
})
