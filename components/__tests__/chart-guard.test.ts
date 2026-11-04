/**
 * Guarda de regresión — todo archivo de gráfico cumple las reglas de identidad
 * visual de `DESIGN.md § Gráficos` (Fase 4 de `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Un «archivo de gráfico» es cualquier `.tsx` bajo `app/` o `components/` que
 * importa un valor de `recharts`. Cuatro reglas, las cuatro sobre el AST (no sobre
 * texto), de modo que un comentario o un nombre parecido no las dispara:
 *
 * 1. **Sin literales de color.** Ningún texto del archivo contiene un hex
 *    (`#1f6feb`), una notación funcional (`rgb(`, `hsl(`, `oklch(`…). El color sale
 *    de `CHART_COLORS` / `CHART_SERIES` (`lib/chart-palette.ts`) o de `var(--color-*)`.
 *    La auditoría encontró ocho hex de Tailwind (azul, violeta, rosa) que nunca
 *    habían pasado la prueba de contraste. Se mira también `lib/chart-palette.ts` y
 *    todo `components/charts/`, que son el inventario de gráficos aunque algunos
 *    se dibujen con CSS y no con recharts.
 *
 * 2. **Nombre accesible.** Cada raíz de gráfico (`BarChart`, `LineChart`,
 *    `AreaChart`, `ComposedChart`, `PieChart`, `ScatterChart`…) lleva nombre, de una
 *    de tres maneras:
 *      a. la propia raíz declara `aria-label`, `aria-labelledby` o `title`
 *         (recharts los entrega al `<svg>`);
 *      b. un ancestro declara `aria-label`/`aria-labelledby` **y un rol** (el
 *         `ChartContainer role="img"`), o es una `<section>`/`<figure>` con nombre.
 *         Un `<div aria-label>` sin rol NO cuenta: el nombre de un contenedor
 *         genérico lo ignoran los lectores de pantalla (así estaban los gráficos de
 *         consumo y de dispersión de combustibles, que sólo se nombraban en el `div`);
 *      c. un ancestro es `ChartSection` o `ChartFrame`, cuyo contrato es dar el
 *         título como encabezado y nombre de la figura.
 *
 * 3. **Movimiento.** Todo archivo que dibuja una serie (`Bar`, `Line`, `Area`,
 *    `Scatter`, `Pie`, `Radar`, `RadialBar`, `Funnel`) obtiene `useChartMotion()` y
 *    lo esparce en **cada** serie (`<Bar {...motion} />`): entrada de ≤ 200 ms y
 *    ninguna animación con «reducir movimiento». Un `isAnimationActive={false}`
 *    fijo o un `animationDuration={460}` propio es justo lo que esto impide:
 *    cada pantalla decidía la suya.
 *
 * 4. **Densos bajo 360 px.** Todo `ScatterChart` va dentro de `<DenseChart>`
 *    (`components/charts/dense-chart.tsx`), que bajo 360 px lo reemplaza por su
 *    tabla o un `RankedList`. Los demás gráficos densos (varias categorías, varios
 *    paneles) están en `DENSAS` y el test exige que sigan usándolo.
 *
 * ── Por qué estas reglas no tienen falsos positivos ────────────────────────
 *
 * Igual criterio que `scripts/migration-sql-checks.mjs`: una regla entra sólo si
 * es objetiva. Todas se deciden sobre el árbol sintáctico, sin juicio:
 *   - Los literales de color se buscan **sólo en cadenas** (comillas y plantillas),
 *     nunca en comentarios, así que la prosa que explica una paleta no dispara.
 *     El hex exige que no lo preceda `&` ni una letra/dígito (`&#8212;` y
 *     `id#abc` no cuentan) ni lo siga `-`/`_`/letra (`#fade-in` no cuenta).
 *     `color-mix(in oklab, …)` no cuenta: nombra un espacio de color, no un valor.
 *     Los nombres de color (`white`, `transparent`) quedan fuera a propósito: una
 *     máscara SVG necesita `white`, y ningún gráfico lo usa para pintar datos.
 *   - «Tiene nombre» se decide por la presencia de un atributo, no por su valor.
 *     Que el texto sea bueno es de la revisión humana, no de este test.
 *   - «Usa el movimiento» es la presencia de un spread del identificador que recibe
 *     `useChartMotion()`.
 *
 * Lo que sí puede ocurrir es un falso NEGATIVO (un gráfico con nombre mal escrito
 * que pasa). Es el costado seguro: el test nunca bloquea una liberación sin culpa.
 *
 * ── Deuda congelada ───────────────────────────────────────────────────────
 *
 * Las listas `*_CONGELADO` son la deuda que existía al crear la guarda: pueden
 * conservarla pero no sumar, y ningún archivo nuevo puede entrar. Cada entrada
 * lleva su razón. Si una razón deja de ser cierta, se corrige el archivo y se saca
 * de la lista (el test avisa de las entradas muertas).
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

const ROOT = process.cwd()
const SCANNED_ROOTS = ["app", "components"]

/** Se mira además del inventario por importación (ver regla 1). */
const COLOR_EXTRA_FILES = ["lib/chart-palette.ts"]
const INVENTORY_DIR = "components/charts/"

const CHART_ROOTS = new Set([
  "BarChart", "LineChart", "AreaChart", "ComposedChart", "PieChart", "ScatterChart",
  "RadialBarChart", "RadarChart", "FunnelChart", "Treemap", "Sankey", "SunburstChart",
])
const SERIES = new Set(["Bar", "Line", "Area", "Scatter", "Pie", "Radar", "RadialBar", "Funnel"])

/** Contenedores cuyo contrato es nombrar el gráfico (`ChartSection` es un `<figure>` con título). */
const NAMING_WRAPPERS = new Set(["ChartSection", "ChartFrame"])
const NAMEABLE_NATIVE = new Set(["section", "figure", "fieldset"])

/** El gráfico denso se reemplaza bajo 360 px (regla 4). */
const DENSE_WRAPPER = "DenseChart"

// ─── Deuda congelada ──────────────────────────────────────────────────────

/** Archivos de gráfico con un literal de color que no se puede cambiar por un token. */
const COLOR_CONGELADO: Record<string, { count: number; why: string }> = {
  "components/ui/chart.tsx": {
    count: 2,
    why:
      "Los selectores Tailwind `[stroke='#ccc']` apuntan al atributo por defecto de recharts " +
      "para sobrescribirlo con un token; el literal es lo que se busca, no lo que se pinta.",
  },
}

/** Raíces de gráfico que no pasan la regla 2 todavía (archivo → cuántas). Vacío es el estado sano. */
const NOMBRE_CONGELADO: Record<string, { count: number; why: string }> = {}

/** Series sin `useChartMotion` (archivo → cuántas). Vacío es el estado sano. */
const MOVIMIENTO_CONGELADO: Record<string, { count: number; why: string }> = {}

/**
 * Gráficos densos que no son `ScatterChart` (la regla 4 los detecta sola) y que se
 * reemplazan bajo 360 px por una tabla o un ranking. El test exige que el archivo
 * use `<DenseChart>`; agregar uno nuevo aquí es bienvenido, quitarlo no.
 */
const DENSAS: Record<string, string> = {
  "app/(app)/combustibles/evolution-by-vehicle-chart.tsx": "paneles pequeños, uno por vehículo (small multiples)",
  "app/(app)/combustibles/consumption-charts.tsx": "ranking de patentes: una barra por patente",
  "app/(app)/combustibles/control/_charts/overview-ranking-chart.tsx": "ranking de faenas: una barra por faena",
  "app/(app)/combustibles/control/_charts/overview-monthly-chart.tsx": "columnas apiladas por medio de suministro: más de 6 segmentos",
  "app/(app)/analitica/analytics-charts.tsx": "Pareto de proveedores: una barra por proveedor",
  "app/(app)/combustibles/cuadratura/estanques/tank-level-chart.tsx": "dos paneles por estanque (nivel y entradas/salidas): small multiples",
}

// ─── Análisis del árbol ───────────────────────────────────────────────────

type Hit = { line: number; text: string }

function parse(relPath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

function opening(node: ts.Node): Opening | null {
  if (ts.isJsxElement(node)) return node.openingElement
  if (ts.isJsxSelfClosingElement(node)) return node
  return null
}

/** `foo` o `Ns.Foo` → texto del tag. */
function tagText(el: Opening, sf: ts.SourceFile): string {
  return el.tagName.getText(sf)
}

function attributeNames(el: Opening): Set<string> {
  const names = new Set<string>()
  for (const prop of el.attributes.properties) {
    if (ts.isJsxAttribute(prop)) names.add(prop.name.getText())
  }
  return names
}

/** Nombre local → nombre importado, y los espacios de nombres, de los `import … from "recharts"` de valor. */
function rechartsImports(sf: ts.SourceFile): { names: Map<string, string>; namespaces: Set<string> } {
  const names = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "recharts") continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue
    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text)
    } else {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue
        names.set(el.name.text, (el.propertyName ?? el.name).text)
      }
    }
  }
  return { names, namespaces }
}

/** El nombre de recharts al que apunta el tag, o `null` si no es de recharts. */
function rechartsName(el: Opening, imports: ReturnType<typeof rechartsImports>): string | null {
  const tag = el.tagName
  if (ts.isIdentifier(tag)) return imports.names.get(tag.text) ?? null
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && imports.namespaces.has(tag.expression.text)) {
    return tag.name.text
  }
  return null
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

const COLOR_PATTERNS: RegExp[] = [
  // Hex de 3, 4, 6 u 8 dígitos: ni `&#8212;` (entidad) ni `#fade-in` (ancla o clase) lo son.
  /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i,
  // Notación funcional de color. `color-mix(in oklab, …)` no coincide: aquí no hay paréntesis tras `oklab`.
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i,
]

/** Literales de color en cadenas del archivo (comillas y plantillas; nunca comentarios). */
function colorLiterals(relPath: string, source: string): Hit[] {
  const sf = parse(relPath, source)
  const hits: Hit[] = []
  walk(sf, (node) => {
    if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      const text = node.text
      if (COLOR_PATTERNS.some((pattern) => pattern.test(text))) hits.push({ line: lineOf(sf, node), text: text.slice(0, 60) })
    }
  })
  return hits
}

/** Nombres locales que el archivo **importa** (de cualquier módulo): un componente declarado aquí no cuenta. */
function importedBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const { name, namedBindings } = statement.importClause
    if (name) names.add(name.text)
    if (namedBindings && ts.isNamedImports(namedBindings)) for (const el of namedBindings.elements) names.add(el.name.text)
  }
  return names
}

function isNamingAncestor(el: Opening, sf: ts.SourceFile, node: ts.Node, imported: Set<string>): boolean {
  const tag = tagText(el, sf)
  // Sólo el `ChartSection`/`ChartFrame` **importado**: pdtp-dashboard-charts declaraba un `ChartSection`
  // propio (una `<section>` con `h2`, sin nombre) y el guarda lo habría dado por bueno.
  if (NAMING_WRAPPERS.has(tag) && imported.has(tag)) return true
  const attrs = attributeNames(el)
  const named = attrs.has("aria-label") || attrs.has("aria-labelledby")
  if (named && attrs.has("role")) return true
  if (named && NAMEABLE_NATIVE.has(tag)) return true
  if (tag === "figure" && node.getText(sf).includes("<figcaption")) return true
  return false
}

/** Raíces de gráfico (recharts) del archivo sin nombre accesible por ninguna de las tres vías. */
function unnamedChartRoots(relPath: string, source: string): Hit[] {
  const sf = parse(relPath, source)
  const imports = rechartsImports(sf)
  const imported = importedBindings(sf)
  const hits: Hit[] = []
  walk(sf, (node) => {
    const el = opening(node)
    if (!el) return
    const name = rechartsName(el, imports)
    if (!name || !CHART_ROOTS.has(name)) return
    const attrs = attributeNames(el)
    if (attrs.has("aria-label") || attrs.has("aria-labelledby") || attrs.has("title")) return
    for (let parent = node.parent; parent; parent = parent.parent) {
      const parentEl = opening(parent)
      if (parentEl && isNamingAncestor(parentEl, sf, parent, imported)) return
    }
    hits.push({ line: lineOf(sf, node), text: `<${name}>` })
  })
  return hits
}

/** Series que no esparcen el objeto de `useChartMotion()`, o todo el archivo si no lo llama. */
function seriesWithoutMotion(relPath: string, source: string): Hit[] {
  const sf = parse(relPath, source)
  const imports = rechartsImports(sf)
  const bound = new Set<string>()
  walk(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useChartMotion"
    ) bound.add(node.name.text)
  })
  const hits: Hit[] = []
  walk(sf, (node) => {
    const el = opening(node)
    if (!el) return
    const name = rechartsName(el, imports)
    if (!name || !SERIES.has(name)) return
    const spreads = el.attributes.properties.some(
      (prop) => ts.isJsxSpreadAttribute(prop) && ts.isIdentifier(prop.expression) && bound.has(prop.expression.text),
    )
    if (!spreads) hits.push({ line: lineOf(sf, node), text: `<${name}>` })
  })
  return hits
}

/** `ScatterChart` fuera de `<DenseChart>`. */
function scatterOutsideDense(relPath: string, source: string): Hit[] {
  const sf = parse(relPath, source)
  const imports = rechartsImports(sf)
  const hits: Hit[] = []
  walk(sf, (node) => {
    const el = opening(node)
    if (!el) return
    if (rechartsName(el, imports) !== "ScatterChart") return
    for (let parent = node.parent; parent; parent = parent.parent) {
      const parentEl = opening(parent)
      if (parentEl && tagText(parentEl, sf) === DENSE_WRAPPER) return
    }
    hits.push({ line: lineOf(sf, node), text: "<ScatterChart>" })
  })
  return hits
}

function importsRecharts(source: string, relPath: string): boolean {
  const { names, namespaces } = rechartsImports(parse(relPath, source))
  return names.size > 0 || namespaces.size > 0
}

function listFiles(): string[] {
  return SCANNED_ROOTS.flatMap((root) =>
    readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
      .filter((rel) => rel.endsWith(".tsx") && !rel.endsWith(".test.tsx") && !rel.includes("/node_modules/")),
  ).sort()
}

const read = (relPath: string) => readFileSync(path.join(ROOT, relPath), "utf8")
const where = (relPath: string, hits: Hit[]) => hits.map((hit) => `  ${relPath}:${hit.line}  ${hit.text}`).join("\n")

const allFiles = listFiles()
const chartFiles = allFiles.filter((rel) => importsRecharts(read(rel), rel))
const colorFiles = [...new Set([...chartFiles, ...allFiles.filter((rel) => rel.startsWith(INVENTORY_DIR)), ...COLOR_EXTRA_FILES])].sort()

// ─── Pruebas del propio detector ──────────────────────────────────────────
// Un guarda que no detecta nada falla en silencio: estas muestras sintéticas
// fijan qué cuenta y qué no, y por qué la regla no tiene falsos positivos.

describe("chart-guard — el detector", () => {
  const head =
    `import { BarChart, Bar, ScatterChart as ReScatter, Scatter } from "recharts"\n` +
    `import { ChartSection } from "@/components/charts/chart-section"\n` +
    `import { ChartFrame } from "@/components/charts/chart-frame"\n`

  it("regla 1: hex y notación funcional cuentan; comentarios, entidades y color-mix no", () => {
    expect(colorLiterals("a.tsx", `const a = "#1f6feb"`)).toHaveLength(1)
    expect(colorLiterals("a.tsx", "const a = `fill-[#fff]`")).toHaveLength(1)
    expect(colorLiterals("a.tsx", `const a = "oklch(0.4 0.1 166)"`)).toHaveLength(1)
    expect(colorLiterals("a.tsx", `const a = "rgba(0,0,0,.2)"`)).toHaveLength(1)
    expect(colorLiterals("a.tsx", `// un hex como "#1f6feb" en prosa\nconst a = 1`)).toHaveLength(0)
    expect(colorLiterals("a.tsx", `const a = "&#8212;"`)).toHaveLength(0)
    expect(colorLiterals("a.tsx", `const a = "#fade-in"`)).toHaveLength(0)
    expect(colorLiterals("a.tsx", `const a = "color-mix(in oklab, var(--x) 40%, transparent)"`)).toHaveLength(0)
    expect(colorLiterals("a.tsx", `const a = "var(--color-primary)"`)).toHaveLength(0)
  })

  it("regla 2: nombre en la raíz, en un ancestro con rol o en ChartSection/ChartFrame; un div con aria-label no basta", () => {
    const named = (jsx: string) => unnamedChartRoots("a.tsx", `${head}export const X = () => (${jsx})`)
    expect(named(`<BarChart data={[]} />`)).toHaveLength(1)
    expect(named(`<BarChart aria-label="x" />`)).toHaveLength(0)
    expect(named(`<BarChart title="x" />`)).toHaveLength(0)
    expect(named(`<div role="img" aria-label="x"><BarChart /></div>`)).toHaveLength(0)
    expect(named(`<div aria-label="x"><BarChart /></div>`)).toHaveLength(1)
    expect(named(`<ChartSection title="x"><BarChart /></ChartSection>`)).toHaveLength(0)
    expect(named(`<ChartFrame title="x"><BarChart /></ChartFrame>`)).toHaveLength(0)
    expect(named(`<section aria-labelledby="t"><BarChart /></section>`)).toHaveLength(0)
    expect(named(`<figure><BarChart /></figure>`)).toHaveLength(1)
    expect(named(`<figure><BarChart /><figcaption>x</figcaption></figure>`)).toHaveLength(0)
    expect(named(`<ReScatter />`)).toHaveLength(1)
    // Un `ChartSection` declarado en el propio archivo no es el primitivo: no da nombre.
    expect(
      unnamedChartRoots(
        "a.tsx",
        `import { BarChart } from "recharts"\nfunction ChartSection({ children }) { return <section>{children}</section> }\n` +
          `export const X = () => (<ChartSection title="x"><BarChart /></ChartSection>)`,
      ),
    ).toHaveLength(1)
    // `Bar` no es raíz: no necesita nombre propio.
    expect(named(`<Bar dataKey="a" />`)).toHaveLength(0)
  })

  it("regla 3: cada serie esparce lo que devuelve useChartMotion()", () => {
    const run = (body: string) => seriesWithoutMotion("a.tsx", `${head}export function X() { ${body} }`)
    expect(run(`return <BarChart><Bar dataKey="a" /></BarChart>`)).toHaveLength(1)
    expect(run(`const motion = useChartMotion(); return <BarChart><Bar dataKey="a" {...motion} /></BarChart>`)).toHaveLength(0)
    expect(run(`const m = useChartMotion(); return <BarChart><Bar dataKey="a" {...m} /><Bar dataKey="b" /></BarChart>`)).toHaveLength(1)
    expect(run(`return <BarChart><Bar dataKey="a" isAnimationActive={false} /></BarChart>`)).toHaveLength(1)
    expect(run(`const motion = useChartMotion(); return <BarChart><Bar dataKey="a" {...other} /></BarChart>`)).toHaveLength(1)
  })

  it("regla 4: un ScatterChart (aunque se importe con alias) debe ir dentro de <DenseChart>", () => {
    const run = (jsx: string) => scatterOutsideDense("a.tsx", `${head}export const X = () => (${jsx})`)
    expect(run(`<ReScatter><Scatter /></ReScatter>`)).toHaveLength(1)
    expect(run(`<DenseChart fallback={null}><ReScatter><Scatter /></ReScatter></DenseChart>`)).toHaveLength(0)
  })
})

// ─── La guarda ────────────────────────────────────────────────────────────

describe("chart-guard — el inventario", () => {
  it("encuentra los archivos de gráfico (el glob no quedó vacío)", () => {
    expect(chartFiles.length).toBeGreaterThan(25)
    expect(chartFiles).toContain("components/charts/monthly-trend-chart.tsx")
    expect(chartFiles).toContain("app/(app)/dashboard/charts/trend-charts.tsx")
  })
})

describe("chart-guard — regla 1: sin literales de color", () => {
  it.each(colorFiles.filter((rel) => !(rel in COLOR_CONGELADO)))("%s no usa colores literales — usar tokens --color-*", (relPath) => {
    const hits = colorLiterals(relPath, read(relPath))
    expect(
      hits,
      `\n${where(relPath, hits)}\nUsa \`CHART_COLORS\` / \`CHART_SERIES\` (lib/chart-palette.ts) o \`var(--color-*)\`. Ver DESIGN.md § Gráficos.`,
    ).toEqual([])
  })

  it.each(Object.entries(COLOR_CONGELADO))("%s (deuda congelada) no suma literales", (relPath, { count }) => {
    expect(colorLiterals(relPath, read(relPath)).length).toBeLessThanOrEqual(count)
  })

  it("la deuda de color congelada no tiene entradas muertas", () => {
    const dead = Object.keys(COLOR_CONGELADO).filter((rel) => colorLiterals(rel, read(rel)).length === 0)
    expect(dead, "ya están limpios: sácalos de COLOR_CONGELADO").toEqual([])
  })
})

describe("chart-guard — regla 2: todo gráfico tiene nombre accesible", () => {
  it.each(chartFiles.filter((rel) => !(rel in NOMBRE_CONGELADO)))("%s nombra cada gráfico", (relPath) => {
    const hits = unnamedChartRoots(relPath, read(relPath))
    expect(
      hits,
      `\n${where(relPath, hits)}\nPon \`aria-label\` en la raíz del gráfico (\`<BarChart aria-label="…">\`), o ` +
        "un ancestro con `role=\"img\"` + `aria-label`, o envuélvelo en `ChartSection`/`ChartFrame`. " +
        "Un `<div aria-label>` sin rol no cuenta. Ver DESIGN.md § Gráficos.",
    ).toEqual([])
  })

  it.each(Object.entries(NOMBRE_CONGELADO))("%s (deuda congelada) no suma gráficos sin nombre", (relPath, { count }) => {
    expect(unnamedChartRoots(relPath, read(relPath)).length).toBeLessThanOrEqual(count)
  })

  it("la deuda de nombre congelada no tiene entradas muertas", () => {
    const dead = Object.keys(NOMBRE_CONGELADO).filter((rel) => unnamedChartRoots(rel, read(rel)).length === 0)
    expect(dead, "ya tienen nombre: sácalos de NOMBRE_CONGELADO").toEqual([])
  })
})

describe("chart-guard — regla 3: movimiento con useChartMotion", () => {
  it.each(chartFiles.filter((rel) => !(rel in MOVIMIENTO_CONGELADO)))("%s anima con useChartMotion", (relPath) => {
    const hits = seriesWithoutMotion(relPath, read(relPath))
    expect(
      hits,
      `\n${where(relPath, hits)}\nLlama \`const motion = useChartMotion()\` (components/ui/chart-interactions.tsx) y ` +
        "esparce `{...motion}` en cada serie: entrada ≤ 200 ms y sin animación con «reducir movimiento». " +
        "Ver DESIGN.md § Gráficos › Movimiento.",
    ).toEqual([])
  })

  it.each(Object.entries(MOVIMIENTO_CONGELADO))("%s (deuda congelada) no suma series sin movimiento", (relPath, { count }) => {
    expect(seriesWithoutMotion(relPath, read(relPath)).length).toBeLessThanOrEqual(count)
  })

  it("la deuda de movimiento congelada no tiene entradas muertas", () => {
    const dead = Object.keys(MOVIMIENTO_CONGELADO).filter((rel) => seriesWithoutMotion(rel, read(rel)).length === 0)
    expect(dead, "ya usan useChartMotion: sácalos de MOVIMIENTO_CONGELADO").toEqual([])
  })
})

describe("chart-guard — regla 4: los gráficos densos se reemplazan bajo 360 px", () => {
  it.each(chartFiles)("%s: todo ScatterChart va dentro de <DenseChart>", (relPath) => {
    const hits = scatterOutsideDense(relPath, read(relPath))
    expect(
      hits,
      `\n${where(relPath, hits)}\nEnvuélvelo en \`<DenseChart fallback={…}>\` (components/charts/dense-chart.tsx): ` +
        "bajo 360 px un diagrama de dispersión es ilegible y se reemplaza por su tabla o un RankedList. " +
        "Ver DESIGN.md § Gráficos › Responsive.",
    ).toEqual([])
  })

  it.each(Object.entries(DENSAS))("%s (%s) usa <DenseChart>", (relPath) => {
    expect(existsSync(path.join(ROOT, relPath)), `${relPath} ya no existe: actualiza DENSAS`).toBe(true)
    expect(
      read(relPath).includes(`<${DENSE_WRAPPER}`),
      `${relPath} es un gráfico denso y debe reemplazarse bajo 360 px con <DenseChart>. Ver DESIGN.md § Gráficos › Responsive.`,
    ).toBe(true)
  })
})
