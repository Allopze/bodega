import fs from "node:fs"
import path from "node:path"
import { test, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"

const OUTPUT_DIR = path.join(process.cwd(), "audit", "ui-ux-2026-07-28")
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots")

const ROUTES = [
  { slug: "dashboard", path: "/dashboard" },
  { slug: "solicitudes", path: "/solicitudes" },
  { slug: "prevencion-pdtp", path: "/prevencion/pdtp" },
  { slug: "combustibles-bitacora", path: "/combustibles/bitacora" },
  { slug: "admin-usuarios", path: "/admin/usuarios" },
] as const

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
] as const

type DomMetrics = {
  documentScrollWidth: number
  viewportWidth: number
  horizontalOverflow: number
  visibleH1: number
  visibleSearchInputs: number
  visibleTopBarTitle: string | null
  landmarks: { headers: number; navs: number; mains: number }
  tables: number
  tablesWithoutName: number
  unlabeledControls: Array<{ tag: string; id: string; name: string; type: string }>
  undersizedTargets: Array<{ tag: string; label: string; width: number; height: number }>
}

type RouteEvidence = {
  route: string
  slug: string
  viewport: string
  width: number
  height: number
  status: number | null
  finalUrl: string
  screenshot: string
  pageErrors: string[]
  consoleErrors: string[]
  metrics: DomMetrics
  axe: Array<{
    id: string
    impact: string | null
    help: string
    helpUrl: string
    nodes: Array<{
      target: string[]
      html: string
      failureSummary: string | undefined
    }>
  }>
}

async function readDomMetrics(page: Page, isMobile: boolean): Promise<DomMetrics> {
  return page.evaluate(({ mobile }) => {
    function visible(element: Element) {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0
    }

    const controlSelector = "input:not([type=hidden]), select, textarea, [role=combobox]"
    const unlabeledControls = Array.from(document.querySelectorAll<HTMLElement>(controlSelector))
      .filter(visible)
      .filter((element) => {
        const id = element.id
        return !element.getAttribute("aria-label")
          && !element.getAttribute("aria-labelledby")
          && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
          && !element.closest("label")
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        name: element.getAttribute("name") ?? "",
        type: element.getAttribute("type") ?? element.getAttribute("role") ?? "",
      }))

    const targetSelector = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=combobox]"
    const undersizedTargets = mobile
      ? Array.from(document.querySelectorAll<HTMLElement>(targetSelector))
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              tag: element.tagName.toLowerCase(),
              label: element.getAttribute("aria-label")
                ?? element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
                ?? "",
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          })
          .filter((target) => target.width < 44 || target.height < 44)
      : []

    const tables = Array.from(document.querySelectorAll("table"))
    const tablesWithoutName = tables.filter((table) =>
      !table.getAttribute("aria-label")
      && !table.getAttribute("aria-labelledby")
      && !table.querySelector("caption")
    ).length

    const topBarTitle = Array.from(document.querySelectorAll("header p"))
      .find((element) => visible(element) && element.classList.contains("truncate"))

    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      visibleH1: Array.from(document.querySelectorAll("h1")).filter(visible).length,
      visibleSearchInputs: Array.from(document.querySelectorAll('input[type="search"]')).filter(visible).length,
      visibleTopBarTitle: topBarTitle?.textContent?.trim() || null,
      landmarks: {
        headers: document.querySelectorAll("header").length,
        navs: document.querySelectorAll("nav").length,
        mains: document.querySelectorAll("main").length,
        // Un `<header>` descendiente de `main` no es `banner`, así que contar
        // `header` no dice si la ruta expone el landmark de cabecera. Hasta el
        // 2026-09-21 ninguna lo hacía: la TopBar vivía dentro de `<main>`.
        bannerTopLevel: Boolean(document.querySelector("header"))
          && document.querySelector("main header") === null,
      },
      tables: tables.length,
      tablesWithoutName,
      unlabeledControls,
      undersizedTargets,
    }
  }, { mobile: isMobile })
}

test("captura evidencia UI/UX en las rutas y viewports críticos", async ({ browser }) => {
  test.setTimeout(360_000)
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  const evidence: RouteEvidence[] = []

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "es-CL",
      reducedMotion: "reduce",
    })
    const authPage = await context.newPage()
    await login(authPage)
    await authPage.close()

    for (const route of ROUTES) {
      const page = await context.newPage()
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on("pageerror", (error) => pageErrors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" })
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined)
      await page.waitForTimeout(350)

      const screenshotName = `${viewport.name}-${route.slug}.png`
      const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName)
      await page.screenshot({ path: screenshotPath, fullPage: false })

      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()

      evidence.push({
        route: route.path,
        slug: route.slug,
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
        status: response?.status() ?? null,
        finalUrl: page.url(),
        screenshot: path.relative(process.cwd(), screenshotPath),
        pageErrors,
        consoleErrors,
        metrics: await readDomMetrics(page, viewport.name === "mobile"),
        axe: axe.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact ?? null,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.map((node) => ({
            target: node.target.map(String),
            html: node.html,
            failureSummary: node.failureSummary,
          })),
        })),
      })

      await page.close()
    }

    await context.close()
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
})
