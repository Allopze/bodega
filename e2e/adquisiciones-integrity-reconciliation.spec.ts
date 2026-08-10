import postgres from "postgres"
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("conciliación separa el total monetario de la evidencia por línea", async ({ page }) => {
  await login(page)
  await page.goto("/compras/oc-e2e?tab=facturacion")

  await expect(page.getByText("Total facturado (CLP)")).toBeVisible()
  const reconciliation = page.getByText("Conciliación por línea").locator("..")
  await expect(reconciliation.getByText("Cobertura parcial de líneas")).toBeVisible()
  await expect(page.getByText("El total difiere de la OC")).toHaveCount(0)
  await expect(page.getByText("1 factura(s) sin líneas.")).toBeVisible()
  await expect(page.getByText("El total monetario no sustituye la evidencia por línea.")).toBeVisible()

  const noLinesInvoice = page.getByRole("listitem").filter({
    has: page.getByRole("link", { name: "FAC-E2E-SIN-LINEAS" }),
  })
  await expect(noLinesInvoice.getByText("Líneas no evaluables")).toBeVisible()
})

test("escanea y regulariza una excepción con un ajuste existente de la misma faena", async ({ page }) => {
  await login(page)
  await page.goto("/trazabilidad")

  await page.getByRole("button", { name: "Revisar historial" }).click()
  const caseRow = page.getByRole("listitem").filter({
    hasText: "req-item-integrity-e2e",
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
