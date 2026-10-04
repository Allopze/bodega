import fs from "node:fs"
import path from "node:path"
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const output = path.join(process.cwd(), "qa/reports/evidence/2026-10-04-miper-uiux-implementation")
const matrix = "/prevencion/miper/riskmatrix-revision-e2e"
const routes = [
  { name: "portada", url: "/prevencion/miper" },
  { name: "inicio", url: `${matrix}?tab=resumen` },
  { name: "riesgos", url: `${matrix}?tab=matriz` },
  { name: "editor", url: `${matrix}?fila=riskentry-revision-e2e-1` },
  { name: "programa", url: `${matrix}?tab=programa` },
  { name: "revision", url: `${matrix}?tab=revision` },
  { name: "control", url: "/prevencion/miper/controles/riskcontrol-revision-e2e-1" },
] as const
const viewports = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const

test("evidencia visual y accesibilidad desktop de MIPER", async ({ browser }) => {
  test.setTimeout(480_000)
  fs.mkdirSync(output, { recursive: true })
  const evidence: Array<Record<string, unknown>> = []

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, locale: "es-CL", reducedMotion: "reduce" })
    const page = await context.newPage()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const failedResponses: string[] = []
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 240)) })
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 240)))
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })
    await login(page)

    for (const route of routes) {
      const before = { console: consoleErrors.length, page: pageErrors.length, http: failedResponses.length }
      const response = await page.goto(route.url, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
      await expect(page.getByRole("main")).toBeVisible()
      const file = `${viewport.name}-${route.name}.png`
      await page.screenshot({ path: path.join(output, file), fullPage: false })
      const metrics = await page.evaluate(() => ({
        documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        shellOverflow: (() => { const shell = document.querySelector<HTMLElement>("[data-shell-scroll]"); return shell ? Math.max(0, shell.scrollWidth - shell.clientWidth) : null })(),
      }))
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
      evidence.push({ viewport: viewport.name, route: route.name, status: response?.status() ?? null, screenshot: file, metrics,
        consoleErrors: consoleErrors.slice(before.console), pageErrors: pageErrors.slice(before.page), failedResponses: failedResponses.slice(before.http),
        axe: axe.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })) })
    }

    if (viewport.name === "1440x900") {
      await page.goto("/prevencion/miper")
      const create = page.getByRole("banner").getByRole("button", { name: "Crear matriz", exact: true })
      await create.focus()
      await page.keyboard.press("Enter")
      await page.getByRole("dialog", { name: "Crear matriz de riesgos" }).getByRole("button", { name: /^Importar desde Excel/ }).click()
      await expect(page.getByRole("dialog", { name: "Importar el RE-04" })).toBeVisible()
      await page.screenshot({ path: path.join(output, "1440x900-importar.png"), fullPage: false })
      evidence.push({ viewport: viewport.name, route: "importar", screenshot: "1440x900-importar.png", keyboard: "Crear matriz abrió con Enter" })

      await page.goto(`${matrix}?tab=programa`)
      await page.getByRole("link", { name: "Abrir el detalle de la actividad N° 1", exact: true }).click()
      await page.screenshot({ path: path.join(output, "1440x900-actividad.png"), fullPage: false })
      evidence.push({ viewport: viewport.name, route: "actividad", screenshot: "1440x900-actividad.png" })

    }

    await context.close()
  }

  {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2, locale: "es-CL", reducedMotion: "reduce" })
    const page = await context.newPage()
    await login(page)
    for (const route of routes) {
      await page.goto(route.url, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
      const file = `zoom200-1280x800-${route.name}.png`
      await page.screenshot({ path: path.join(output, file), fullPage: false })
      evidence.push({ viewport: "1280x800 al 200 % (640x400 CSS, DPR 2)", route: route.name, screenshot: file,
        metrics: await page.evaluate(() => ({
          documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          shellOverflow: (() => { const shell = document.querySelector<HTMLElement>("[data-shell-scroll]"); return shell ? Math.max(0, shell.scrollWidth - shell.clientWidth) : null })(),
        })) })
    }
    await context.close()
  }

  fs.writeFileSync(path.join(output, "browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
})
