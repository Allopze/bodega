import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import { CHECKS, NOT_DONE_ITEM, PERIOD, QA, cleanupLooker, leftovers, seedLooker } from "./mantencion-panel-looker-seed"
import {
  FLOW, accessIsOriginal, barOf, barsOf, chileDay, chipsOf, cleanupExtra, equipmentTable, extraLeftovers, filterBar, funnelOf, param, paramsOf,
  planningTable, ready, row, seedExtra, tabUrl, watchProblems, withSql, workTable,
} from "./mantencion-panel-looker-seed-extra"

/**
 * UN recorrido de punta a punta del Panel de mantención con estado (2026-11-27), el de quien entra con un enlace viejo y termina
 * revisando la ficha de un equipo. Todo en una sola prueba y una sola página, porque cada paso parte de lo que dejó el anterior:
 *
 *  1. `pestana=camiones` (enlace guardado) aterriza en Correctivo por kilómetros, con la URL canónica;
 *  2. «Por horas»;
 *  3. filtra por un conductor (chip + tabla) y lo quita con un segundo clic;
 *  4. Planificación: «Próximos 30 días» (la vencida sigue en la lista);
 *  5. «Vencidas»;
 *  6. la patente abre el historial filtrado y «atrás» vuelve al panel con sus filtros;
 *  7. Preventivo: un equipo abre su ficha con lo no hecho primero; cambia de pauta; «atrás» la cierra;
 *  8. recarga con `ficha` y `pauta` en la URL; Escape la cierra;
 *  9. teclado completo en los embudos, los atajos de fecha y las pestañas de pautas;
 * 10. la consola no trae errores ni respuestas 4xx/5xx del origen.
 *
 * Siembra SUS PROPIOS datos QA (`seedLooker` + las dos máquinas del flujo; lecturas relativas a hoy porque la fecha estimada mira los
 * últimos 30 días) y los borra al terminar. Los controles existen en el HTML del servidor pero NO responden hasta hidratar: antes de
 * cada clic se espera `ready`.
 */

test.setTimeout(240_000)

const A = QA.wsA.id
const PERIOD_PARAMS = Object.fromEntries(new URLSearchParams(PERIOD))
const M1_NOV = CHECKS.m1Nov.key
const M1_OCT = CHECKS.m1Oct.key

test.beforeAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await seedLooker(sql)
    await seedExtra(sql, { flow: true })
  })
})
test.afterAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await cleanupLooker(sql)
    expect(await leftovers(sql)).toBe(0)
    expect(await extraLeftovers(sql)).toBe(0)
    expect(await accessIsOriginal(sql)).toBe(true)
  })
})

/** Tab hasta que el foco llegue a `target` (sin clic previo: parte de donde esté el foco). */
async function focusByTab(page: Page, target: Locator, max = 60) {
  for (let step = 0; step < max; step++) {
    if (await target.evaluate((el) => el === document.activeElement)) return step
    await page.keyboard.press("Tab")
  }
  throw new Error(`Tab no llegó al control tras ${max} pulsaciones`)
}

/** Un clic fija el punto de partida de Tab (`from`) y avanza hasta `target`. */
async function tabFrom(page: Page, from: Locator, target: Locator, max = 80) {
  await from.click()
  for (let step = 0; step < max; step++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((el) => el === document.activeElement)) return step + 1
  }
  throw new Error(`Tab no llegó al control tras ${max} pulsaciones`)
}

/** Enter fija el filtro y Espacio lo quita; `aria-pressed`, la URL y el foco acompañan cada paso. */
async function pressTwice(page: Page, control: Locator, key: string, value: string) {
  await expect(control).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("Enter")
  await expect.poll(() => param(page, key)).toBe(value)
  await expect(control).toHaveAttribute("aria-pressed", "true")
  await expect(control).toBeFocused()
  await page.keyboard.press("Space")
  await expect.poll(() => param(page, key)).toBeNull()
  await expect(control).toHaveAttribute("aria-pressed", "false")
  await expect(control).toBeFocused()
}

test("flujo: enlace viejo → Correctivo por horas → conductor → Planificación (vencidas) → historial → ficha de Preventivo → teclado", async ({ page }) => {
  const problems = watchProblems(page)
  await login(page, "admin@e2e.chome.cl")
  // `login` termina en /dashboard; las respuestas del origen que se miran son las del recorrido (el login ya se hizo).
  problems.length = 0

  const nav = page.getByRole("navigation", { name: "Secciones del panel de mantención" })
  const unit = () => filterBar(page).getByRole("group", { name: "Unidad de control" })
  const chip = (label: string) => chipsOf(page, label)

  /* ── 1. Enlace guardado de «Por kilómetros»: aterriza en Correctivo, por kilómetros, con la URL canónica ─────────────────────── */
  await test.step("1. pestana=camiones aterriza en Correctivo por kilómetros", async () => {
    await page.goto(tabUrl("camiones", { faena: A }))
    await expectPageTitle(page, "Panel de mantención")
    await expect(page).toHaveURL(/pestana=correctivo/)
    // Canónica: la pestaña nueva, el período y la faena; la unidad por kilómetros no se escribe.
    expect(paramsOf(page)).toEqual({ pestana: "correctivo", ...PERIOD_PARAMS, faena: A })
    await expect(nav.getByRole("link", { name: "Correctivo", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(unit().getByRole("link", { name: "Por kilómetros", exact: true })).toHaveAttribute("aria-current", "page")
    await ready(page)
    await expect(row(workTable(page), QA.otA1)).toBeVisible()
    await expect(row(workTable(page), QA.otM1)).toHaveCount(0)
  })

  /* ── 2. «Por horas» ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
  await test.step("2. «Por horas» cambia de unidad y de trabajos", async () => {
    await unit().getByRole("link", { name: "Por horas", exact: true }).click()
    await expect.poll(() => param(page, "unidad")).toBe("h")
    expect(paramsOf(page)).toEqual({ pestana: "correctivo", unidad: "h", ...PERIOD_PARAMS, faena: A })
    await expect(unit().getByRole("link", { name: "Por horas", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(workTable(page).getByRole("columnheader", { name: "Horómetro" })).toBeVisible()
    await expect(row(workTable(page), QA.otM1)).toBeVisible()
    await expect(row(workTable(page), FLOW.workRef)).toBeVisible()
    await expect(row(workTable(page), QA.otA1)).toHaveCount(0)
    await expect(page.getByText("2 trabajos", { exact: true })).toBeVisible()
    await ready(page)
  })

  /* ── 3. Un conductor: chip y tabla; el segundo clic lo quita ─────────────────────────────────────────────────────────────── */
  await test.step("3. filtrar por un conductor y quitarlo con un segundo clic", async () => {
    const drivers = barsOf(page, "Horas trabajadas por conductor")
    const bar = barOf(drivers, QA.driverM.name)
    await bar.click()
    await expect.poll(() => param(page, "x_conductor")).toBe(QA.driverM.name)
    await expect(chip("Conductor")).toContainText(QA.driverM.name)
    await expect(bar).toHaveAttribute("aria-pressed", "true")
    await expect(row(workTable(page), QA.otM1)).toBeVisible()
    await expect(row(workTable(page), FLOW.workRef)).toHaveCount(0)
    await expect(page.getByText("1 trabajo", { exact: true })).toBeVisible()
    // El gráfico no se filtra a sí mismo: el otro conductor sigue a la vista, atenuado.
    await expect(barOf(drivers, FLOW.driver)).toBeVisible()

    await bar.click()
    await expect.poll(() => param(page, "x_conductor")).toBeNull()
    await expect(chip("Conductor")).toHaveCount(0)
    await expect(bar).toHaveAttribute("aria-pressed", "false")
    await expect(row(workTable(page), FLOW.workRef)).toBeVisible()
    await expect(page.getByText("2 trabajos", { exact: true })).toBeVisible()
  })

  /* ── 4. Planificación: «Próximos 30 días» deja dentro a la vencida ───────────────────────────────────────────────────────── */
  await test.step("4. Planificación: «Próximos 30 días» (la vencida sigue en la lista)", async () => {
    await nav.getByRole("link", { name: "Planificación", exact: true }).click()
    await expect(page).toHaveURL(/pestana=planificacion/)
    // La pestaña conserva la unidad, el período y la faena.
    expect(paramsOf(page)).toEqual({ pestana: "planificacion", unidad: "h", ...PERIOD_PARAMS, faena: A })
    await ready(page)
    const table = planningTable(page, "h")
    await expect(row(table, FLOW.late.plate)).toBeVisible()
    await expect(row(table, FLOW.ok.plate)).toBeVisible()

    const shortcuts = page.getByRole("group", { name: "Atajos (incluyen las vencidas)" })
    const in30 = shortcuts.getByRole("button", { name: "Próximos 30 días", exact: true })
    await in30.click()
    await expect.poll(() => param(page, "fecha_hasta")).toBe(chileDay(30))
    expect(param(page, "fecha_desde")).toBeNull()
    await expect(in30).toHaveAttribute("aria-pressed", "true")
    await expect(chip("Próxima mantención")).toBeVisible()
    // La máquina vencida (su fecha estimada ya pasó) sigue; la que está al día (≈ 40 días) y las sin fecha, no.
    await expect(row(table, FLOW.late.plate)).toBeVisible()
    await expect(row(table, FLOW.late.plate)).toContainText("Vencida")
    await expect(row(table, FLOW.ok.plate)).toHaveCount(0)
  })

  /* ── 5. «Vencidas» ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
  await test.step("5. «Vencidas» de la tira de cifras", async () => {
    const overdue = page.locator("[data-planning-summary]").getByRole("link", { name: /^Vencidas/ })
    await expect(overdue).toContainText("1")
    await overdue.click()
    await expect.poll(() => param(page, "estado")).toBe("vencida")
    await expect(overdue).toHaveAttribute("aria-current", "true")
    await expect(chip("Estado")).toContainText("Vencidas")
    await expect(planningTable(page, "h").getByRole("row")).toHaveCount(2) // encabezado + la vencida
    await expect(row(planningTable(page, "h"), FLOW.late.plate)).toBeVisible()
  })

  /* ── 6. La patente abre el historial filtrado; «atrás» vuelve con los filtros ───────────────────────────────────────────── */
  await test.step("6. la patente abre el historial del equipo y «atrás» vuelve al panel con sus filtros", async () => {
    const panelUrl = page.url()
    await row(planningTable(page, "h"), FLOW.late.plate).getByRole("link", { name: FLOW.late.plate, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/mantencion/registros/historicos\\?.*equipo=${FLOW.late.id}`))
    await expectPageTitle(page, "Historial de mantenciones")

    await page.goBack()
    await expect(page).toHaveURL(panelUrl)
    expect(paramsOf(page)).toMatchObject({ pestana: "planificacion", unidad: "h", estado: "vencida", fecha_hasta: chileDay(30), faena: A })
    await expect(chip("Estado")).toContainText("Vencidas")
    await expect(row(planningTable(page, "h"), FLOW.late.plate)).toBeVisible()
    await ready(page)
  })

  /* ── 7. Preventivo: un equipo abre su ficha, lo no hecho va primero; cambia de pauta; «atrás» la cierra ──────────────────── */
  await test.step("7. Preventivo: la ficha del equipo, lo no hecho primero, otra pauta y «atrás»", async () => {
    await nav.getByRole("link", { name: "Preventivo", exact: true }).click()
    await expect(page).toHaveURL(/pestana=preventivo/)
    // Se conservan unidad, período y faena; el estado y las fechas de Planificación se sueltan.
    expect(paramsOf(page)).toEqual({ pestana: "preventivo", unidad: "h", ...PERIOD_PARAMS, faena: A })
    await ready(page)
    const preventiveUrl = page.url()

    await equipmentTable(page).getByRole("link", { name: QA.m1.plate, exact: true }).click()
    const sheet = page.getByRole("dialog", { name: QA.m1.plate })
    await expect(sheet).toBeVisible()
    await expect.poll(() => param(page, "ficha")).toBe(QA.m1.id)
    expect(param(page, "pauta")).toBeNull()

    // Encabezado, lo pendiente del período y las pautas, la más reciente primero.
    await expect(sheet.getByRole("heading", { name: "Pendiente en el período" })).toBeVisible()
    await expect(sheet.getByRole("list", { name: "Ítems pendientes" })).toContainText(NOT_DONE_ITEM)
    const tabs = sheet.getByRole("tablist")
    await expect(tabs.getByRole("tab")).toHaveCount(2)
    await expect(tabs.getByRole("tab").first()).toContainText("05-11-2026 · 300 H")
    await expect(tabs.getByRole("tab").nth(1)).toContainText("20-10-2026 · 600 H")
    await expect(tabs.getByRole("tab", { selected: true })).toContainText("300 H")

    // Lo que no se hizo va ANTES que lo que se hizo, con su sistema y el aviso de que el formulario no trae motivo.
    const notDone = sheet.getByRole("region", { name: "Ítems que no se hicieron" })
    const done = sheet.getByRole("region", { name: "Ítems realizados" })
    await expect(notDone).toContainText(`No realizado: ${NOT_DONE_ITEM}`)
    await expect(notDone).toContainText("Sin sistema")
    await expect(notDone).toContainText("Sin motivo en el formulario")
    await expect(done).toContainText("QA_ Nivel hidráulico")
    const [notDoneBox, doneBox] = [await notDone.boundingBox(), await done.boundingBox()]
    expect(notDoneBox!.y).toBeLessThan(doneBox!.y)
    // «No aplica en este nivel» arranca plegado.
    const notApplicable = sheet.locator("details").filter({ hasText: "No aplica en este nivel" })
    await expect(notApplicable).toHaveJSProperty("open", false)
    // Pie: historial del equipo (preventivas del período) y, si la pauta es de la plataforma, el registro.
    await expect(sheet.getByRole("link", { name: "Historial del equipo", exact: true })).toHaveAttribute("href", new RegExp(`equipo=${QA.m1.id}.*tipo=preventiva|tipo=preventiva.*equipo=${QA.m1.id}`))

    // Otra pauta: el panel de detalle cambia y la URL guarda la pauta (con `replace`).
    await tabs.getByRole("tab").nth(1).click()
    await expect.poll(() => param(page, "pauta")).toBe(`h:${M1_OCT}`)
    await expect(tabs.getByRole("tab", { selected: true })).toContainText("600 H")
    await expect(notDone).toContainText("QA_ Nivel hidráulico")
    await expect(notDone).not.toContainText(NOT_DONE_ITEM)

    // «Atrás» cierra la ficha (se abrió con `push`): el panel queda como estaba.
    await page.goBack()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(preventiveUrl)
    expect(param(page, "ficha")).toBeNull()
  })

  /* ── 8. Recarga con ficha y pauta en la URL; Escape cierra ──────────────────────────────────────────────────────────────── */
  await test.step("8. recargar con ficha y pauta; Escape cierra", async () => {
    await page.goto(`${page.url()}&ficha=${QA.m1.id}&pauta=h:${M1_OCT}`)
    const sheet = page.getByRole("dialog", { name: QA.m1.plate })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("tab", { selected: true })).toContainText("600 H")
    await page.reload()
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("tab", { selected: true })).toContainText("600 H")
    expect(paramsOf(page)).toMatchObject({ ficha: QA.m1.id, pauta: `h:${M1_OCT}` })

    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    // Se cargó con la ficha abierta: no hay nada atrás a lo que volver, así que Escape quita sus parámetros.
    await expect.poll(() => param(page, "ficha")).toBeNull()
    expect(param(page, "pauta")).toBeNull()
    expect(paramsOf(page)).toEqual({ pestana: "preventivo", unidad: "h", ...PERIOD_PARAMS, faena: A })
    await ready(page)
  })

  /* ── 9. Teclado completo ────────────────────────────────────────────────────────────────────────────────────────────────── */
  await test.step("9a. teclado: el embudo de un equipo (Enter fija, Espacio quita)", async () => {
    const funnel = funnelOf(equipmentTable(page), `Filtrar el panel por ${QA.m1.plate}`)
    await tabFrom(page, page.getByRole("heading", { name: "Cumplimiento por equipo", exact: true }), funnel)
    await pressTwice(page, funnel, "x_equipo", QA.m1.id)
  })

  await test.step("9b. teclado: la ficha se abre con Enter y las pestañas de pautas con las flechas, Inicio y Fin", async () => {
    const link = equipmentTable(page).getByRole("link", { name: QA.m1.plate, exact: true })
    await tabFrom(page, page.getByRole("heading", { name: "Cumplimiento por equipo", exact: true }), link)
    await page.keyboard.press("Enter")
    const sheet = page.getByRole("dialog", { name: QA.m1.plate })
    await expect(sheet).toBeVisible()
    await expect.poll(() => param(page, "ficha")).toBe(QA.m1.id)

    // El foco queda dentro del diálogo y las pestañas se alcanzan con Tab (sin ratón).
    const tabs = sheet.getByRole("tablist").getByRole("tab")
    const [first, second] = [tabs.first(), tabs.nth(1)]
    await expect(first).toHaveAttribute("aria-selected", "true")
    await focusByTab(page, first)
    await expect(first).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(second).toBeFocused()
    await expect(second).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => param(page, "pauta")).toBe(`h:${M1_OCT}`)
    await page.keyboard.press("ArrowLeft")
    await expect(first).toBeFocused()
    await expect(first).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => param(page, "pauta")).toBe(`h:${M1_NOV}`)
    await page.keyboard.press("End")
    await expect(second).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Home")
    await expect(first).toHaveAttribute("aria-selected", "true")
    // Cada pauta lleva su detalle: la de noviembre, el ítem sin hacer; la de octubre, otro.
    await expect(sheet.getByRole("region", { name: "Ítems que no se hicieron" })).toContainText(NOT_DONE_ITEM)
    await page.keyboard.press("End")
    await expect(sheet.getByRole("region", { name: "Ítems que no se hicieron" })).not.toContainText(NOT_DONE_ITEM)

    // Tab sigue por el panel y por el pie sin escapar del diálogo, y Escape lo cierra devolviendo el foco al panel.
    await focusByTab(page, sheet.getByRole("link", { name: "Historial del equipo", exact: true }))
    await expect(sheet.getByRole("link", { name: "Historial del equipo", exact: true })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect.poll(() => param(page, "ficha")).toBeNull()
  })

  await test.step("9c. teclado: los atajos «Próximos N días» y el embudo de Planificación", async () => {
    await page.goto(tabUrl("planificacion", { faena: A, unidad: "h" }))
    await ready(page)
    const shortcuts = page.getByRole("group", { name: "Atajos (incluyen las vencidas)" })
    const in30 = shortcuts.getByRole("button", { name: "Próximos 30 días", exact: true })
    await tabFrom(page, page.getByText("Atajos (incluyen las vencidas)", { exact: true }), in30)
    await expect(in30).toBeFocused()
    await pressTwice(page, in30, "fecha_hasta", chileDay(30))

    // Las flechas de Tab entre atajos: el siguiente es «Próximos 90 días» y se opera igual.
    await page.keyboard.press("Tab")
    const in90 = shortcuts.getByRole("button", { name: "Próximos 90 días", exact: true })
    await expect(in90).toBeFocused()
    await pressTwice(page, in90, "fecha_hasta", chileDay(90))

    const funnel = funnelOf(planningTable(page, "h"), `Filtrar el panel por ${FLOW.late.plate}`)
    await tabFrom(page, page.getByRole("heading", { name: "Detalle por equipo", exact: true }), funnel)
    await pressTwice(page, funnel, "x_equipo", FLOW.late.id)
  })

  /* ── 10. Consola limpia ─────────────────────────────────────────────────────────────────────────────────────────────────── */
  expect(problems, "errores de consola y respuestas 4xx/5xx del recorrido").toEqual([])
})
