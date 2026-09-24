import { expect, test, type Page } from "@playwright/test"

import { startFakeWebdav, type FakeWebdav } from "./fixtures/fake-webdav"
import { listRecord, login, selectRadixById } from "./helpers"

/**
 * Documentos generados → Cloudreve (decisión del 2026-09-24).
 *
 * El servidor E2E tiene sus credenciales de Cloudreve apuntando a un WebDAV en
 * memoria (`e2e/fixtures/fake-webdav.ts`), así que acá se ve el camino entero
 * —Administración lo enciende, una entrega de EPP deja su comprobante en la
 * carpeta de la faena, y un Cloudreve caído se recupera con «Reintentar»— sin
 * tocar el drive real.
 */

const FAENA = "Faena E2E"
const PRODUCTO = "Casco EPP E2E"
const COMPROBANTE = /^Documentos generados\/Faena E2E\/Comprobante de entrega ENT-[^/]+ - registrada(?: \(\d+\))?\.pdf$/

let files = new Map<string, Buffer>()
let webdav: FakeWebdav | null = null

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  files = new Map()
  webdav = await startFakeWebdav(files)
})

test.afterAll(async () => {
  await webdav?.close()
})

async function openStorage(page: Page) {
  await page.goto("/admin/almacenamiento")
  const card = page.getByRole("region", { name: "Documentos generados" })
  await expect(card).toBeVisible()
  return card
}

async function setArchive(page: Page, enabled: boolean) {
  const card = await openStorage(page)
  const toggle = card.getByLabel("Archivar los documentos generados en Cloudreve")
  await expect(toggle).toBeEnabled()
  await toggle.setChecked(enabled)
  await card.getByRole("button", { name: "Guardar", exact: true }).click()
  await expect(page.getByText(enabled ? /Archivado encendido/ : /El archivado está apagado/).first()).toBeVisible({ timeout: 15_000 })
}

async function registerEppDelivery(page: Page, receiver: string) {
  await page.goto("/entregas")
  const sheet = page.getByRole("dialog", { name: "Registrar entrega" })
  await expect(async () => {
    await page.getByRole("button", { name: "Registrar entrega" }).first().click()
    await expect(sheet).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await selectRadixById(page, "deliverySourceWorksite", FAENA)
  await selectRadixById(page, "deliveryWorker", /Trabajador E2E/)
  await selectRadixById(page, "deliveryProduct", new RegExp(PRODUCTO))
  await page.locator("#deliveryPendingQuantity").fill("1")
  await page.getByRole("button", { name: "Agregar" }).click()
  await page.locator("#deliveryReceiverName").fill(receiver)
  await sheet.getByRole("button", { name: "Registrar entrega" }).click()
  await expect(sheet).toBeHidden({ timeout: 30_000 })
  await expect(listRecord(page, new RegExp(receiver)).first()).toBeVisible({ timeout: 30_000 })
}

function uploadedReceipts(): string[] {
  return [...files.keys()].filter((key) => COMPROBANTE.test(key))
}

test("Administración enciende el archivado y prueba la carpeta", async ({ page }) => {
  await login(page)
  const card = await openStorage(page)
  await expect(card.getByText(/debe ser restringida en Cloudreve/)).toBeVisible()
  await setArchive(page, true)

  await card.getByRole("button", { name: "Probar carpeta" }).click()
  await expect(page.getByText(/se creará con el primer documento/).first()).toBeVisible({ timeout: 15_000 })
})

test("una entrega de EPP deja su comprobante en la carpeta de la faena", async ({ page }) => {
  test.setTimeout(180_000)
  await login(page)
  await registerEppDelivery(page, "Receptor Cloudreve E2E")

  // El comprobante se imprime y se sube después de responder (after()).
  await expect.poll(() => uploadedReceipts().length, { timeout: 60_000 }).toBe(1)
  const [key] = uploadedReceipts()
  expect(files.get(key!)!.subarray(0, 4).toString("latin1")).toBe("%PDF")

  const card = await openStorage(page)
  await expect(card.getByText(key!)).toBeVisible()
})

test("con Cloudreve caído queda por subir y «Reintentar» lo sube", async ({ page }) => {
  test.setTimeout(180_000)
  await login(page)
  const before = uploadedReceipts().length
  await webdav!.close()
  try {
    await registerEppDelivery(page, "Receptor sin Cloudreve E2E")

    // Impreso y guardado en disco, pero sin subir.
    const card = await openStorage(page)
    const pending = card.getByRole("listitem").filter({ hasText: "Comprobante de entrega de EPP · registrada" })
    await expect(async () => {
      await page.reload()
      await expect(pending.filter({ hasText: "Por subir" }).first()).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 60_000 })
    await expect(pending.first().getByText("No se pudo conectar con Cloudreve.")).toBeVisible()
  } finally {
    webdav = await startFakeWebdav(files)
  }

  const card = await openStorage(page)
  const pending = card.getByRole("listitem").filter({ hasText: "Comprobante de entrega de EPP · registrada" }).first()
  await pending.getByRole("button", { name: "Reintentar" }).click()
  await expect(page.getByText("Documento subido a Cloudreve.").first()).toBeVisible({ timeout: 30_000 })
  expect(uploadedReceipts().length).toBe(before + 1)
})

test("apagar el archivado deja de encolar documentos", async ({ page }) => {
  await login(page)
  await setArchive(page, false)
})
