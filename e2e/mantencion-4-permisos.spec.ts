import { createHash, randomUUID } from "node:crypto"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import sharp from "sharp"
import { cerrarSesion, login } from "./helpers"
import type { MantCatalog, MantCatalogOthers } from "../lib/mantencion/contracts"

/**
 * §16 E2E 8 · Permisos en la UI y en la API del módulo de mantención.
 *
 * Corre después de las otras tres specs del módulo (`mantencion-1…3`), sobre el
 * estado que dejaron. Lo que prueba es que la frontera es el servidor:
 * - un mecánico no entra a las vistas de jefatura escribiendo la URL;
 * - la sincronización sin credencial, o con una revocada, se rechaza;
 * - el catálogo de un mecánico sólo trae los equipos de sus faenas;
 * - un registro en otra faena queda «fuera de faena» y el supervisor de
 *   Biodiversa no lo ve ni por la lista ni por su URL directa.
 */

test.describe.configure({ mode: "serial" })

const MEC2 = "mecanico2@e2e.chome.cl"
let foreignRecordId = ""
let mec2Token = ""

async function deviceToken(page: Page): Promise<string> {
  const response = await page.request.post("/api/mantencion/dispositivo", {
    data: { deviceId: randomUUID(), label: "E2E permisos" },
  })
  expect(response.status()).toBe(200)
  const body = await response.json() as { token: string }
  expect(body.token.length).toBeGreaterThan(20)
  return body.token
}

async function bearerGet<T>(request: APIRequestContext, token: string, path: string): Promise<{ status: number; body: T | null }> {
  const response = await request.get(path, { headers: { authorization: `Bearer ${token}` } })
  return { status: response.status(), body: response.status() === 200 ? await response.json() as T : null }
}

test("un mecánico no entra a las vistas de jefatura por URL", async ({ page }) => {
  await login(page, "mecanico1@e2e.chome.cl")
  for (const url of ["/mantencion/panel", "/mantencion/equipos", "/mantencion/equipos/nuevo", "/mantencion/pautas", "/mantencion/dispositivos"]) {
    const response = await page.goto(url)
    const blocked = page.url().includes("/forbidden") || response?.status() === 403 || response?.status() === 404
    expect(blocked, `${url} debe quedar bloqueada para un mecánico`).toBe(true)
  }
  // La navegación no ofrece la jefatura: sólo la app y sus registros.
  await page.goto("/m/mantencion")
  await expect(page).toHaveURL(/\/m\/mantencion/)
  await cerrarSesion(page)
})

test("la sincronización exige credencial de dispositivo", async ({ request }) => {
  const anonymous = await request.get("/api/mantencion/sync/catalogo")
  expect(anonymous.status()).toBe(401)
  const forged = await request.get("/api/mantencion/sync/catalogo", { headers: { authorization: "Bearer credencial-inventada" } })
  expect(forged.status()).toBe(401)
  const post = await request.post("/api/mantencion/sync/registros", { data: {} })
  expect(post.status()).toBe(401)
})

test("el catálogo del mecánico trae sólo sus faenas y un registro ajeno queda fuera de faena", async ({ page }) => {
  await login(page, MEC2)
  mec2Token = await deviceToken(page)

  const mine = await bearerGet<MantCatalog>(page.request, mec2Token, "/api/mantencion/sync/catalogo")
  expect(mine.status).toBe(200)
  expect(mine.body!.equipment.length).toBeGreaterThan(0)
  expect(new Set(mine.body!.equipment.map((equipment) => equipment.worksiteName))).toEqual(new Set(["Biodiversa"]))

  const others = await bearerGet<MantCatalogOthers>(page.request, mec2Token, "/api/mantencion/sync/catalogo?alcance=todos")
  expect(others.status).toBe(200)
  const target = others.body!.equipment.find((equipment) => equipment.worksiteName === "Cholguan" && equipment.unit === "km")
  expect(target, "debe haber un equipo de Cholguan en la carga liviana").toBeTruthy()

  // Correctiva por API sobre un equipo de otra faena: foto primero, registro después.
  const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#4b4f54" } }).jpeg().toBuffer()
  const photoId = randomUUID()
  const upload = await page.request.put(`/api/mantencion/sync/fotos/${photoId}`, {
    headers: { authorization: `Bearer ${mec2Token}` },
    multipart: {
      file: { name: "trabajo.jpg", mimeType: "image/jpeg", buffer: photo },
      meta: JSON.stringify({
        kind: "correctiva", sha256: createHash("sha256").update(photo).digest("hex"), width: 64, height: 48,
        stampedAt: new Date().toISOString(), takenAtExif: null, exif: null, deviceId: randomUUID(),
      }),
    },
  })
  expect(upload.status()).toBe(200)

  const catalog = mine.body!
  const lastReading = target!.readings[0]?.value ?? 0
  foreignRecordId = randomUUID()
  const created = await page.request.post("/api/mantencion/sync/registros", {
    headers: { authorization: `Bearer ${mec2Token}` },
    data: {
      id: foreignRecordId, kind: "C", vehicleId: target!.id, reading: lastReading + 50,
      workDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date()),
      signedAt: new Date().toISOString(), offlineSince: null, deviceId: randomUUID(), appVersion: "e2e",
      readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
      photos: [{ id: photoId, kind: "correctiva" }],
      workTypeIds: [catalog.workTypes[0]!.id], oilIds: [], noOilChange: true,
      executor: { kind: "yo" }, description: "Cambio de manguera hidráulica E2E", parts: [], noParts: true,
      hours: 1.5, inWorkshop: false, workshopEntryDate: null, workOrder: null, driverIds: [catalog.drivers[0]!.id],
    },
  })
  expect(created.status()).toBe(200)
  const body = await created.json() as { ok: boolean; folio: string; warnings: Array<{ code: string }> }
  expect(body.ok).toBe(true)
  expect(body.folio).toMatch(/^MC-CHO-\d{4}$/)
  expect(body.warnings.map((warning) => warning.code)).toContain("out_of_worksite")
  await cerrarSesion(page)
})

test("el supervisor de Biodiversa no ve el registro de Cholguan ni por su URL", async ({ page }) => {
  await login(page, "supervisor@e2e.chome.cl")
  await page.goto("/mantencion/registros")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByText(/MC-CHO-/)).toHaveCount(0)
  const direct = await page.goto(`/mantencion/registros/${foreignRecordId}`)
  expect(direct?.status()).toBe(404)
  await cerrarSesion(page)
})

test("jefatura ve la alerta fuera de faena y revoca la credencial del dispositivo", async ({ page }) => {
  await login(page, "jefe.mant@e2e.chome.cl")
  await page.goto(`/mantencion/registros/${foreignRecordId}`)
  await expect(page.getByText("Fuera de faena", { exact: false }).first()).toBeVisible()

  await page.goto("/mantencion/dispositivos")
  const row = page.getByRole("row").filter({ hasText: MEC2 }).filter({ hasText: /vigente/i }).first()
  await row.getByRole("button", { name: /Revocar/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: /Revocar/ }).click()
  await expect(page.getByRole("row").filter({ hasText: MEC2 }).filter({ hasText: /revocada/i }).first()).toBeVisible()

  const revoked = await page.request.get("/api/mantencion/sync/catalogo", { headers: { authorization: `Bearer ${mec2Token}` } })
  expect(revoked.status()).toBe(401)
})
