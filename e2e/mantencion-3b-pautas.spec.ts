import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import { expectPageTitle, login, selectRadixById } from "./helpers"
import { MECANICO, SCHEDULE, ITEM, asJefe, trackConsole, withSql, fichaValue, idFromPath, scheduleState } from "./mantencion-3-helpers"
import type { MantCatalog } from "../lib/mantencion/contracts"

/**
 * §16 E2E 7 · Jefatura de mantención: pautas (después de `mantencion-3a-equipos.spec.ts`).
 *
 * Con estado y en orden: corre después de la spec de jefatura (`mantencion-2-jefatura`)
 * y sólo depende de la carga inicial (120 equipos, las pautas «Camiones y tractos» y
 * «Maquinaria pesada») y de la cuenta `jefe.mant@e2e.chome.cl`. Todo lo que crea lleva
 * el prefijo `QA-` / `QA ` para reconocerlo, y al final deja los equipos de prueba
 * dados de baja.
 *
 * E2E 6 (equipos): alta con faena nueva escrita con otra tilde (se reutiliza la
 * existente), edición, importación con vista previa (filas válidas y con error) y baja.
 * E2E 7 (pautas): crear copiando otra, agregar un intervalo y un ítem, quitar con
 * «Deshacer», asignar equipos con el resumen de cambios, y comprobar que la app del
 * mecánico recibe la pauta nueva; por último eliminarla.
 *
 * Los locators siguen «Locators in this repository» de AGENTS.md: `getByRole`
 * (ignora los nodos ocultos de las vistas duplicadas) y `exact: true` cuando un
 * rótulo es prefijo de otro. Las versiones y los snapshots de las pautas se leen de la
 * base: la pantalla no muestra la versión en un nodo visible a todos los anchos.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

/**
 * Los equipos que dejó la spec de equipos se recuperan por código desde la base:
 * Playwright no comparte variables entre archivos.
 */
const ids = { eq1: "", eq2: "", im1: "", schedule: "" }

test.beforeAll(async () => {
  const rows = await withSql((sql) => sql`select id, code from fuel_vehicles where code in ('QA-EQ1', 'QA-EQ2', 'QA-IM1')`)
  const byCode = new Map(rows.map((row) => [row.code as string, row.id as string]))
  ids.eq1 = byCode.get("QA-EQ1") ?? ""
  ids.eq2 = byCode.get("QA-EQ2") ?? ""
  ids.im1 = byCode.get("QA-IM1") ?? ""
  expect(ids.eq1 && ids.eq2 && ids.im1, "la spec de equipos debe haber creado QA-EQ1, QA-EQ2 y QA-IM1").toBeTruthy()
})

test.describe("E2E 7 · Pautas", () => {
  test("crea una pauta copiando otra: sus ítems y reglas por marca vienen, el intervalo nuevo queda por revisar", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/pautas")
    await expectPageTitle(page, "Pautas de mantención")
    await expect(page.getByRole("link", { name: "Camiones y tractos", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Maquinaria pesada", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Nueva pauta", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Nueva pauta" })).toBeVisible()
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill(SCHEDULE)
    await dialog.getByRole("textbox", { name: "Intervalos", exact: true }).fill("10.000, 30000")
    await selectRadixById(page, "np-copy", "Copia de «Camiones y tractos»")
    await dialog.getByRole("button", { name: "Crear pauta", exact: true }).click()

    await expect(page).toHaveURL(/\/mantencion\/pautas\/(?!$)[^/?]+/)
    ids.schedule = idFromPath(page)
    await expectPageTitle(page, SCHEDULE)
    // 10.000 existía en la pauta de origen; 30.000 no: hereda la columna de 10.000 y queda «Por revisar».
    const intervals = page.getByRole("list", { name: "Intervalos de la pauta" })
    await expect(intervals.getByRole("listitem").filter({ hasText: "30.000 km" })).toContainText("Por revisar")
    await expect(intervals.getByRole("listitem").filter({ hasText: "10.000 km" })).not.toContainText("Por revisar")
    await expect(page.getByRole("button", { name: "Inspección visual general en 10.000 km", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("table", { name: "Reglas por marca de cada actividad" })).toBeVisible()
    const state = await scheduleState(SCHEDULE)
    expect(state?.version).toBe(1)
    expect((state?.versions[0]?.snapshot as { intervals: number[] }).intervals).toEqual([10000, 30000])
    expect(errors).toEqual([])
  })

  test("el encabezado de la matriz queda fijo al bajar y los sistemas se pliegan", async ({ page }) => {
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const header = page.getByRole("table", { name: "Actividades de la pauta por intervalo" }).getByRole("columnheader", { name: "Actividad", exact: true })
    await expect(header).toBeVisible()
    const wellTop = (await page.locator("[data-shell-scroll]").boundingBox())?.y ?? 0
    await page.evaluate(() => {
      const well = document.querySelector("[data-shell-scroll]")
      if (well) well.scrollTop = 900
    })
    // `sticky top-0` mide contra el pozo: el encabezado se queda pegado a su borde superior aunque la matriz haya subido.
    await expect.poll(async () => Math.abs(((await header.boundingBox())?.y ?? 10_000) - wellTop)).toBeLessThan(3)
    await page.evaluate(() => { const well = document.querySelector("[data-shell-scroll]"); if (well) well.scrollTop = 0 })

    const motor = page.getByRole("button", { name: /^Motor/ })
    await expect(motor).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("rowheader", { name: "Inspección visual general" })).toBeVisible()
    await motor.click()
    await expect(motor).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("rowheader", { name: "Inspección visual general" })).toHaveCount(0)
    await motor.click()
    await expect(page.getByRole("rowheader", { name: "Inspección visual general" })).toBeVisible()
  })

  test("agrega un intervalo (hereda la columna y queda por revisar) y lo quita con «Deshacer»", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const before = (await scheduleState(SCHEDULE))!.version
    await page.getByRole("textbox", { name: "Nuevo intervalo (km)", exact: true }).fill("50000")
    await page.getByRole("button", { name: "Agregar intervalo", exact: true }).click()
    const intervals = page.getByRole("list", { name: "Intervalos de la pauta" })
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).toContainText("Por revisar")
    expect((await scheduleState(SCHEDULE))!.version).toBe(before + 1)

    // Tocar una celda de esa columna la da por revisada. Mientras está por revisar, el nombre de sus casillas lo dice.
    await page.getByRole("button", { name: "Inspección visual general en 50.000 km (columna por revisar)", exact: true }).click()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).not.toContainText("Por revisar")

    await page.getByRole("button", { name: "Quitar el intervalo de 50.000 km", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "¿Quitar el intervalo de 50.000 km?" })).toBeVisible()
    await dialog.getByRole("button", { name: "Quitar intervalo", exact: true }).click()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).toHaveCount(0)
    await page.getByRole("button", { name: "Deshacer", exact: true }).click()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("quitar un intervalo pide confirmar con el impacto; cancelar no cambia nada y volver a agregarlo devuelve SU columna", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const intervals = page.getByRole("list", { name: "Intervalos de la pauta" })
    const remove = page.getByRole("button", { name: "Quitar el intervalo de 50.000 km", exact: true })
    const cell = page.getByRole("button", { name: "Inspección visual general en 50.000 km", exact: true })
    const version = (await scheduleState(SCHEDULE))!.version

    // En esta etapa la pauta aún no tiene equipos: el diálogo lo dice en vez de inventar un número.
    await remove.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Ningún equipo usa esta pauta todavía, así que nadie deja de tener la mantención de 50.000 km.")).toBeVisible()
    await expect(dialog.getByText("Los registros ya firmados no cambian.")).toBeVisible()
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).toBeVisible()
    await expect(remove).toBeFocused() // cancelar devuelve el foco al botón que abrió el diálogo
    expect((await scheduleState(SCHEDULE))!.version).toBe(version)

    // 50.000 hereda de 10.000, donde el ítem aplica; en 50.000 el test anterior lo desmarcó. Si «restituir» copiara otra columna volvería marcado.
    await expect(cell).toHaveAttribute("aria-pressed", "false")
    await remove.click()
    await page.getByRole("dialog").getByRole("button", { name: "Quitar intervalo", exact: true }).click()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).toHaveCount(0)
    await page.getByRole("textbox", { name: "Nuevo intervalo (km)", exact: true }).fill("50000")
    await page.getByRole("button", { name: "Agregar intervalo", exact: true }).click()
    await expect(page.getByText("Intervalo de 50.000 km restituido con su columna.", { exact: true })).toBeVisible()
    await expect(intervals.getByRole("listitem").filter({ hasText: "50.000 km" })).not.toContainText("Por revisar")
    await expect(cell).toHaveAttribute("aria-pressed", "false")
    expect(errors).toEqual([])
  })

  test("con teclado la matriz es una sola parada de Tab y las flechas recorren sus casillas", async ({ page }) => {
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const matrix = page.getByRole("table", { name: "Actividades de la pauta por intervalo" })
    const gridButtons = matrix.locator('button[aria-pressed], button[aria-label^="Quitar "]')
    // `count()` no espera: sin esto cuenta antes de que la matriz se dibuje.
    await expect(gridButtons.first()).toBeVisible()
    expect(await gridButtons.count()).toBeGreaterThan(20)
    await expect(matrix.locator('button[aria-pressed][tabindex="0"], button[aria-label^="Quitar "][tabindex="0"]')).toHaveCount(1)

    const first = page.getByRole("button", { name: "Inspección visual general en 10.000 km", exact: true })
    await first.focus()
    await expect(first).toHaveAttribute("tabindex", "0")
    const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")
    await page.keyboard.press("ArrowRight")
    await expect.poll(focusedLabel).toMatch(/^Inspección visual general en 30\.000 km/)
    await page.keyboard.press("ArrowDown")
    await expect.poll(focusedLabel).toMatch(/ en 30\.000 km/)
    expect(await focusedLabel()).not.toMatch(/^Inspección visual general/)
    await page.keyboard.press("End")
    await expect.poll(focusedLabel).toMatch(/^Quitar .* de la pauta$/)
    await page.keyboard.press("Home")
    await expect.poll(focusedLabel).toMatch(/ en 10\.000 km/)
    // Tab sale de la matriz: el foco no sigue en una de sus casillas.
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => {
      const active = document.activeElement
      return !!active && (active.hasAttribute("aria-pressed") || (active.getAttribute("aria-label") ?? "").startsWith("Quitar "))
    })).toBe(false)
  })

  test("en móvil las casillas, «Quitar» y «Quitar el intervalo» miden al menos 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const sizeOf = async (locator: ReturnType<typeof page.getByRole>) => {
      const box = await locator.boundingBox()
      return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }
    }
    const cell = await sizeOf(page.getByRole("button", { name: "Inspección visual general en 10.000 km", exact: true }))
    expect(cell.width).toBeGreaterThanOrEqual(44)
    expect(cell.height).toBeGreaterThanOrEqual(44)
    const interval = await sizeOf(page.getByRole("button", { name: "Quitar el intervalo de 10.000 km", exact: true }))
    expect(interval.width).toBeGreaterThanOrEqual(44)
    expect(interval.height).toBeGreaterThanOrEqual(44)
    const row = await sizeOf(page.getByRole("button", { name: /^Quitar Inspección visual general de la pauta$/ }))
    expect(row.height).toBeGreaterThanOrEqual(44)
    // Y en la tabla de reglas por marca.
    const rule = await sizeOf(page.getByRole("table", { name: "Reglas por marca de cada actividad" }).getByRole("button").first())
    expect(rule.height).toBeGreaterThanOrEqual(44)
  })

  test("el nombre se guarda al salir del campo y lo dice en línea («Guardado»), sin toast", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const name = page.getByRole("textbox", { name: "Nombre de la pauta", exact: true })
    await name.fill(`${SCHEDULE} B`)
    await name.blur()
    await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible()
    await expectPageTitle(page, `${SCHEDULE} B`)
    // Lo deja como estaba para el resto de la spec, que busca la pauta por su nombre.
    await name.fill(SCHEDULE)
    await name.blur()
    await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible()
    await expectPageTitle(page, SCHEDULE)
    expect(errors).toEqual([])
  })

  test("agrega un ítem en un sistema, lo quita con «Deshacer» y cada edición sube la versión sin tocar las anteriores", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const first = (await scheduleState(SCHEDULE))!
    await page.getByRole("button", { name: "+ Agregar ítem en Motor", exact: true }).click()
    await page.getByRole("textbox", { name: "Nuevo ítem en Motor", exact: true }).fill(ITEM)
    await page.getByRole("button", { name: "Agregar", exact: true }).click()
    await expect(page.getByRole("rowheader", { name: ITEM })).toBeVisible()
    await page.getByRole("button", { name: "Listo", exact: true }).click()

    // «Quitar» se ve al pasar el mouse por la fila; está separado de las casillas.
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: ITEM }) })
    await row.hover()
    await page.getByRole("button", { name: `Quitar ${ITEM} de la pauta`, exact: true }).click()
    await expect(page.getByRole("rowheader", { name: ITEM })).toHaveCount(0)
    await page.getByRole("button", { name: "Deshacer", exact: true }).click()
    await expect(page.getByRole("rowheader", { name: ITEM })).toBeVisible()

    const after = (await scheduleState(SCHEDULE))!
    expect(after.version).toBeGreaterThan(first.version + 2) // agregar, quitar y deshacer
    const snapshots = after.versions.map((row) => ({ version: row.version as number, snapshot: row.snapshot as { groups: Array<{ items: Array<{ name: string }> }> } }))
    const hasItem = (version: number) => snapshots.find((row) => row.version === version)?.snapshot.groups.some((group) => group.items.some((item) => item.name === ITEM))
    expect(hasItem(first.version)).toBe(false) // la versión anterior queda intacta
    expect(hasItem(after.version)).toBe(true)
    expect(errors).toEqual([])
  })

  test("rota una regla por marca con un clic y la celda dice su estado con símbolo y texto", async ({ page }) => {
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    const rules = page.getByRole("table", { name: "Reglas por marca de cada actividad" })
    const cell = rules.getByRole("button").first()
    const label = (await cell.getAttribute("aria-label")) ?? ""
    expect(label).toMatch(/: (Aplica|Revisar con pauta del fabricante|No aplica)\. Tocar para cambiar a /)
    await cell.click()
    await expect.poll(async () => (await cell.getAttribute("aria-label")) ?? "").not.toBe(label)
    await expect(page.getByRole("list", { name: "Significado de los símbolos" })).toContainText("Revisar con pauta del fabricante")
  })

  test("asigna equipos: lista por faena, cada fila dice qué le pasa y el pie resume los cambios", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    await page.getByRole("button", { name: "Asignar equipos", exact: true }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: `Asignar equipos a «${SCHEDULE}»` })).toBeVisible()

    // Casilla de grupo con estado parcial: marcar los de una faena y desmarcar uno.
    await dialog.getByRole("combobox", { name: "Filtrar por faena" }).click()
    await page.getByRole("option", { name: "Biodiversa", exact: true }).click()
    await dialog.getByRole("button", { name: "Marcar los filtrados", exact: true }).click()
    const group = dialog.getByRole("checkbox", { name: "Marcar todos los equipos de Biodiversa" })
    await expect(group).toBeChecked()
    await dialog.getByRole("checkbox", { name: /QA-EQ2/ }).uncheck()
    await expect(group).toHaveJSProperty("indeterminate", true)
    await dialog.getByRole("button", { name: "Desmarcar los filtrados", exact: true }).click()

    // Selección final: sólo los dos equipos de prueba, uno sin pauta y otro con «Camiones y tractos».
    await dialog.getByRole("combobox", { name: "Filtrar por faena" }).click()
    await page.getByRole("option", { name: "Todas las faenas", exact: true }).click()
    await dialog.getByRole("searchbox", { name: "Buscar por código, patente o marca", exact: true }).fill("QA-EQ")
    await dialog.getByRole("button", { name: "Marcar los filtrados", exact: true }).click()
    await expect(dialog.getByRole("listitem").filter({ hasText: "QA-EQ2" })).toContainText("Se agrega")
    await expect(dialog.getByRole("listitem").filter({ hasText: "QA-EQ1" })).toContainText("Cambia desde «Camiones y tractos»")
    await expect(dialog.getByText("2 equipos seleccionados · 1 se agrega · 1 cambia de pauta")).toBeVisible()

    await dialog.getByRole("button", { name: "Guardar asignación", exact: true }).click()
    await expect(page.getByText("1 equipo asignado · 1 equipo cambió de pauta")).toBeVisible()
    await expect(page.getByText("2 equipos activos", { exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Ver los 2 equipos en Equipos", exact: true })).toBeVisible()
    const history = await withSql(async (sql) => sql`
      select h.summary from mant_equipment_history h join fuel_vehicles v on v.id = h.vehicle_id
      where v.code in ('QA-EQ1', 'QA-EQ2') and h.action = 'schedule_change' order by h.created_at desc limit 2`)
    expect(history.map((row) => row.summary).sort()).toEqual([
      `Pauta asignada: «${SCHEDULE}» (antes «Camiones y tractos»)`,
      `Pauta asignada: «${SCHEDULE}»`,
    ].sort())
    expect(errors).toEqual([])
  })

  test("la app del mecánico usa la pauta nueva: el catálogo trae sus intervalos, su ítem y el equipo asignado", async ({ page }) => {
    await login(page, MECANICO)
    const credential = await page.request.post("/api/mantencion/dispositivo", { data: { deviceId: randomUUID(), label: "E2E equipos y pautas" } })
    expect(credential.status()).toBe(200)
    const { token } = await credential.json() as { token: string }
    const response = await page.request.get("/api/mantencion/sync/catalogo", { headers: { authorization: `Bearer ${token}` } })
    expect(response.status()).toBe(200)
    const catalog = await response.json() as MantCatalog

    const schedule = catalog.schedules.find((item) => item.id === ids.schedule)
    expect(schedule, "la pauta nueva debe estar en el catálogo").toBeTruthy()
    expect(schedule?.name).toBe(SCHEDULE)
    expect(schedule?.intervals).toEqual([10000, 30000, 50000])
    expect(schedule?.groups.flatMap((group) => group.items.map((item) => item.name))).toContain(ITEM)
    // QA-EQ2 es de Biodiversa (la faena de este mecánico): el catálogo lo trae con la pauta nueva.
    const equipment = catalog.equipment.find((item) => item.id === ids.eq2)
    expect(equipment?.scheduleId).toBe(ids.schedule)
    // La versión que descarga la app es la vigente de la pauta.
    expect(schedule?.version).toBe((await scheduleState(SCHEDULE))!.version)
    await page.goto("/m/mantencion")
    await expect(page).toHaveURL(/\/m\/mantencion/)
  })

  test("elimina la pauta: el diálogo dice cuántos equipos quedan sin pauta y el borrado es lógico", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/pautas/${ids.schedule}`)
    await page.getByRole("button", { name: "Eliminar pauta", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/2 equipos quedarán sin pauta/)).toBeVisible()
    await dialog.getByRole("button", { name: "Eliminar pauta", exact: true }).click()

    await expect(page).toHaveURL(/\/mantencion\/pautas$/)
    await expect(page.getByText("Pauta eliminada. 2 equipos quedaron sin pauta.")).toBeVisible()
    await expect(page.getByRole("link", { name: SCHEDULE, exact: true })).toHaveCount(0)
    expect(await withSql(async (sql) => (await sql`select deleted_at from mant_schedules where id = ${ids.schedule}`)[0]?.deleted_at)).not.toBeNull()
    const released = await withSql(async (sql) => sql`select v.code, p.schedule_id from mant_equipment_profiles p join fuel_vehicles v on v.id = p.vehicle_id where v.code in ('QA-EQ1', 'QA-EQ2')`)
    expect(released.every((row) => row.schedule_id === null)).toBe(true)
    // Y la lista de equipos los muestra sin pauta.
    await page.goto("/mantencion/equipos?pauta=sin")
    await expect(page.getByRole("link", { name: "QA-EQ2", exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("limpieza: los equipos de prueba quedan dados de baja", async ({ page }) => {
    await asJefe(page)
    for (const id of [ids.eq1, ids.eq2, ids.im1]) {
      await page.goto(`/mantencion/equipos/${id}`)
      await page.getByRole("button", { name: "Editar ficha", exact: true }).click()
      await page.getByRole("radio", { name: "Dado de baja", exact: true }).check()
      await page.getByRole("textbox", { name: "Motivo de la baja", exact: true }).fill("Equipo de prueba automática")
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click()
      await expect(fichaValue(page, "Estado")).toContainText("Dado de baja")
    }
  })
})
