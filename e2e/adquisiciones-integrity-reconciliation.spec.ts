import postgres from "postgres"
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("conciliación separa el total monetario de la evidencia por línea", async ({ page }) => {
  await login(page)
  await page.goto("/compras/oc-e2e?tab=facturacion")

  // La tarjeta compara línea por línea; el total monetario ya no es la unidad de
  // medida de la conciliación.
  await expect(page.getByRole("heading", { name: "Conciliación de facturación" })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("columnheader", { name: "Cantidad OC / aceptada / factura" })).toBeVisible()
  // Y una factura sin líneas se declara como tal en vez de diluirse en el total.
  // Aparece una vez por factura sin líneas; basta con que la advertencia exista.
  await expect(page.getByText("Factura sin líneas documentales").first()).toBeVisible()

  const noLinesInvoice = page.getByRole("listitem").filter({
    has: page.getByRole("link", { name: "FAC-E2E-SIN-LINEAS" }),
  })
  await expect(noLinesInvoice.getByText("Líneas no evaluables")).toBeVisible()
})

test("escanea y regulariza una excepción con un ajuste existente de la misma faena", async ({ page }) => {
  await login(page)
  // Las excepciones de integridad viven en su propia pestaña desde que
  // Trazabilidad se dividió en tres (`Seguimiento por faena`, `Buscar por
  // código`, `Integridad`): en la pestaña por omisión el bloque no se monta.
  await page.goto("/bodega/trazabilidad?tab=integridad")

  await page.getByRole("button", { name: "Revisar historial" }).click()
  // El id del ítem ya no se imprime en la tarjeta: quedó sólo en el `href` del
  // enlace al expediente, así que filtrar por texto no encontraba nada aunque el
  // caso estuviera ahí.
  const caseRow = page.getByRole("listitem").filter({
    has: page.locator('a[href="/bodega/trazabilidad/req-item-integrity-e2e"]'),
  })
  await expect(caseRow).toHaveCount(1)

  await caseRow.getByLabel("Resolución").click()
  await page.getByRole("option", { name: "Vincular ajuste compensatorio" }).click()
  await caseRow.getByLabel("Ajuste compensatorio existente").click()
  await page.getByRole("option", { name: /Casco EPP E2E.*Ajuste compensatorio E2E/ }).click()
  await caseRow.getByLabel("Motivo").fill("Se documenta la excepción con el ajuste existente de la misma faena.")
  await caseRow.getByRole("button", { name: "Regularizar caso" }).click()
  await expect(caseRow.getByText("Regularizado")).toBeVisible()
  await expect(caseRow.getByRole("button", { name: "Regularizar caso" })).toHaveCount(0)

  const databaseUrl = process.env.E2E_DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const resolutions = await sql<{
      action: string
      compensatingMovementId: string | null
      reason: string
    }[]>`
      SELECT resolution.action, resolution.compensating_movement_id AS "compensatingMovementId", resolution.reason
      FROM traceability_integrity_resolutions AS resolution
      INNER JOIN traceability_integrity_cases AS integrity_case ON integrity_case.id = resolution.case_id
      WHERE integrity_case.request_item_id = 'req-item-integrity-e2e'
    `
    expect(resolutions).toEqual([{
      action: "compensating_movement",
      compensatingMovementId: "adjustment-integrity-e2e",
      reason: "Se documenta la excepción con el ajuste existente de la misma faena.",
    }])

    const adjustments = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM inventory_movements
      WHERE worksite_id = 'ws-e2e' AND type = 'ajuste' AND reason = 'Ajuste compensatorio E2E'
    `
    expect(adjustments[0]?.count).toBe("1")
  } finally {
    await sql.end()
  }
})
