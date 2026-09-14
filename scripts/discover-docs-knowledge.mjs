/**
 * discover-docs-knowledge.mjs — Base de conocimiento para la documentación generada.
 *
 * Recorre el código y escribe docs/.knowledge/ con: módulos del registry, sus
 * páginas, endpoints, server actions, permisos, tablas alcanzadas y relaciones
 * por foreign key.
 *
 * Todo lo que escribe se deriva del código: nada se infiere a mano. La salida es
 * regenerable, por eso docs/.knowledge/ no se versiona.
 *
 *   node scripts/discover-docs-knowledge.mjs
 *
 * Depende de scripts/.tmp-docs-registry.json, que se genera ejecutando el
 * registry con tsx (ver README en docs/.knowledge/README.md).
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCRATCH = process.env.DOCS_DISCOVER_TMP || path.join(ROOT, "scripts")
const registry = JSON.parse(fs.readFileSync(path.join(SCRATCH, ".tmp-docs-registry.json"), "utf8"))

function walk(dir, out = []) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".next") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = p => path.relative(ROOT, p).split(path.sep).join("/")

// ---------- 1. schema: symbol -> table ----------
const schemaFiles = walk(path.join(ROOT, "db/schema")).filter(f => f.endsWith(".ts"))
const tables = {}   // symbol -> {symbol, table, file, columns[], enums}
const enums = {}    // symbol -> {symbol, name, values, file}

for (const f of schemaFiles) {
  const src = fs.readFileSync(f, "utf8")
  const r = rel(f)
  for (const m of src.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*"([^"]+)"\s*,\s*(?:\(\s*\)\s*=>\s*)?\{([\s\S]*?)\n\s*\}\s*[,)]/g)) {
    const [, symbol, table, body] = m
    const columns = []
    for (const c of body.matchAll(/^\s{2,4}(\w+):\s*([a-zA-Z_]\w*)\(([^\n]*)$/gm)) {
      const [, col, kind, tail] = c
      const dbName = (tail.match(/^\s*"([^"]+)"/) || [])[1] || null
      columns.push({
        name: col,
        kind,
        db_name: dbName,
        not_null: /\.notNull\(\)/.test(tail),
        primary_key: /\.primaryKey\(\)/.test(tail),
        unique: /\.unique\(\)/.test(tail),
        default: (tail.match(/\.default\(([^)]*)\)/) || [])[1] || null,
        references: (tail.match(/references\(\(\)\s*=>\s*(\w+)\.(\w+)/) || []).slice(1, 3).join(".") || null,
        on_delete: (tail.match(/onDelete:\s*"([^"]+)"/) || [])[1] || null,
      })
    }
    // Los valores permitidos no viven en pgEnum sino en constraints CHECK con IN (...)
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 4000)
    const checks = []
    for (const ck of after.matchAll(/check\(\s*"([^"]+)"\s*,\s*sql`([\s\S]*?)`\s*\)/g)) {
      const name = ck[1], expr = ck[2].replace(/\s+/g, " ").trim()
      const allowed = {}
      for (const inm of expr.matchAll(/\$\{table\.(\w+)\}\s+IN\s*\(([^)]*)\)/gi)) {
        allowed[inm[1]] = [...inm[2].matchAll(/'([^']*)'/g)].map(x => x[1])
      }
      checks.push({ name, expression: expr, allowed_values: Object.keys(allowed).length ? allowed : undefined })
    }
    for (const c of columns) {
      const vals = checks.flatMap(k => (k.allowed_values && k.allowed_values[c.name]) || [])
      if (vals.length) c.allowed_values = [...new Set(vals)]
    }
    tables[symbol] = { symbol, table, file: r, columns, checks }
  }
}

// ---------- 2. routes ----------
const appFiles = walk(path.join(ROOT, "app"))
const pageOf = f => {
  const r = rel(f)
  if (!/\/page\.tsx$/.test(r)) return null
  let route = r.replace(/^app/, "").replace(/\/page\.tsx$/, "")
  route = route.replace(/\/\([^)]+\)/g, "")
  return route === "" ? "/" : route
}
const pages = []
for (const f of appFiles) {
  const route = pageOf(f)
  if (route) pages.push({ route, file: rel(f), group: (rel(f).match(/^app\/\(([^)]+)\)/) || [])[1] || null })
}
const apiRoutes = []
for (const f of appFiles) {
  const r = rel(f)
  if (!/^app\/api\/.*\/route\.ts$/.test(r)) continue
  const src = fs.readFileSync(f, "utf8")
  const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1])
  const methods2 = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)].map(m => m[1])
  apiRoutes.push({ path: r.replace(/^app/, "").replace(/\/route\.ts$/, ""), file: r, methods: [...new Set([...methods, ...methods2])] })
}

// ---------- 3. module prefixes ----------
// Prefijos que ningún manifest declara en su navegación pero que pertenecen al módulo.
const FALLBACK = {
  admin:        ["/admin", "/backups"],
  repuestos:    ["/repuestos"],
  servicios:    ["/servicios"],
  prevention:   ["/prevencion"],
  warehouse:    ["/trazabilidad"],
  ppa:          ["/ppa"],
  combustibles: ["/tae"],
  purchasing:   ["/purchase-orders", "/dte-portal"],
}
// Páginas y endpoints transversales: no pertenecen a un módulo del registry.
const SHELL_PREFIXES = ["/", "/dashboard", "/perfil", "/login", "/registro", "/recuperar",
  "/forbidden", "/modulo-inactivo", "/[...not-found]", "/reportar-incidente", "/acuse",
  "/auth", "/health", "/cron", "/notifications", "/attachments"]
const isShell = r => r === "/" || SHELL_PREFIXES.some(p => p !== "/" && (r === p || r.startsWith(p + "/")))
const prefixes = []  // {module, prefix}
for (const m of registry) {
  const hrefs = new Set()
  for (const s of m.nav || []) for (const it of s.items) {
    if (it.href) hrefs.add(it.href)
    for (const c of it.children || []) if (c.href) hrefs.add(c.href)
  }
  for (const p of FALLBACK[m.id] || []) hrefs.add(p)
  for (const h of hrefs) prefixes.push({ module: m.id, prefix: h })
}
prefixes.sort((a, b) => b.prefix.length - a.prefix.length)
const moduleFor = route => {
  for (const { module, prefix } of prefixes) {
    if (route === prefix || route.startsWith(prefix + "/")) return module
  }
  return null
}

// ---------- 4. assemble ----------
const mods = {}
for (const m of registry) mods[m.id] = {
  id: m.id, pages: [], api: [], schema_symbols: new Map(), schema_files: new Set(),
  components: new Set(), services: new Set(), actions: [], permissions: m.permissions,
  permission_meta: m.permissionMeta, nav: m.nav, has_seed: m.hasSeed, default_grants: m.defaultGrants,
}
const unassignedPages = [], unassignedApi = []
const shell = { pages: [], api: [] }

const importsOf = src => ({
  schema: [...src.matchAll(/import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*"@\/db\/schema[^"]*"/g)]
    .flatMap(m => m[1].split(",").map(s => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)),
  components: [...src.matchAll(/from\s*"(@\/components\/[^"]+)"/g)].map(m => m[1]),
  services: [...src.matchAll(/from\s*"(@\/lib\/(?:services|[^"]*?)\/[^"]+)"/g)].map(m => m[1]),
  relatives: [...src.matchAll(/from\s*"(\.[^"]+)"/g)].map(m => m[1]),
})

// Resuelve un alias "@/..." a un archivo real del repo.
const resolveAlias = spec => {
  const base = path.join(ROOT, spec.replace(/^@\//, ""))
  for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return rel(cand)
  }
  return null
}

const MAX_HOPS = 4   // página -> componente -> barrel de servicios -> servicio -> consulta
const collect = (modId, file, hops = MAX_HOPS, seen = new Set()) => {
  if (seen.has(file)) return
  seen.add(file)
  let src
  try { src = fs.readFileSync(path.join(ROOT, file), "utf8") } catch { return }
  const i = importsOf(src)
  const M = mods[modId]
  const depth = MAX_HOPS - hops
  for (const s of i.schema) if (tables[s]) {
    M.schema_files.add(tables[s].file)
    const prev = M.schema_symbols.get(s)
    if (prev === undefined || depth < prev) M.schema_symbols.set(s, depth)
  }
  for (const c of i.components) M.components.add(c)
  for (const s of i.services) M.services.add(s)
  if (hops <= 0) return
  // Sigue los imports de lib/ para alcanzar la capa que realmente consulta la base.
  for (const spec of i.services) {
    const target = resolveAlias(spec)
    if (target && target.startsWith("lib/")) collect(modId, target, hops - 1, seen)
  }
  // Las páginas suelen delegar en componentes colocalizados por ruta relativa.
  const dir = path.dirname(file)
  for (const spec of i.relatives) {
    const target = resolveAlias("@/" + path.normalize(path.join(dir, spec)).split(path.sep).join("/"))
    if (target && !target.includes("/node_modules/") && !/\.(test|spec)\.tsx?$/.test(target)) {
      collect(modId, target, hops - 1, seen)
    }
  }
}

for (const p of pages) {
  const modId = moduleFor(p.route)
  if (!modId) { (isShell(p.route) ? shell.pages : unassignedPages).push(p); continue }
  mods[modId].pages.push(p)
  // page + sibling files in the same route dir
  const dir = path.dirname(p.file)
  for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(n => /\.tsx?$/.test(n))) {
    const fp = `${dir}/${f}`
    collect(modId, fp)
    if (f === "actions.ts") {
      const src = fs.readFileSync(path.join(ROOT, fp), "utf8")
      const names = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(m => m[1])
      mods[modId].actions.push({ file: fp, exports: names })
    }
  }
}
for (const a of apiRoutes) {
  const seg = a.path.replace(/^\/api/, "")
  const modId = moduleFor(seg)
  if (!modId) { (isShell(seg) ? shell.api : unassignedApi).push(a); continue }
  mods[modId].api.push(a)
  collect(modId, a.file)
}

// ---------- 5. write knowledge base ----------
const KB = path.join(ROOT, "docs/.knowledge")
const w = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n") }
const NOW = new Date().toISOString()

const index = []
for (const m of registry) {
  const M = mods[m.id]
  const modTables = [...M.schema_symbols.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([sym, depth]) => ({ ...tables[sym], depth }))

  w(path.join(KB, "modules", m.id, "entity.json"), {
    module: m.id, discovered_at: NOW,
    source: "símbolos de @/db/schema alcanzados desde las páginas y endpoints del módulo, siguiendo hasta 4 saltos de import",
    tables: modTables.map(t => ({
      symbol: t.symbol, table: t.table, file: t.file,
      // 0 = la tabla se usa en la página o el endpoint; mayor = se alcanza a través de la capa de servicios.
      import_depth: t.depth,
      fields: t.columns.map(c => ({
        name: c.name, type: c.kind, column: c.db_name,
        required: c.not_null, primary: c.primary_key || undefined, unique: c.unique || undefined,
        default: c.default || undefined, references: c.references || undefined, on_delete: c.on_delete || undefined,
        allowed_values: c.allowed_values || undefined,
      })),
      check_constraints: t.checks,
      relationships: t.columns.filter(c => c.references).map(c => ({
        type: "belongs_to", via: c.name, references: c.references, on_delete: c.on_delete,
      })),
    })),
    note_enums: "El esquema no usa pgEnum. Los valores permitidos se declaran en constraints CHECK y se reflejan en allowed_values.",
  })

  w(path.join(KB, "modules", m.id, "routes.json"), {
    module: m.id, discovered_at: NOW,
    pages: M.pages.map(p => ({ route: p.route, file: p.file, group: p.group, dynamic: /\[/.test(p.route) })).sort((a, b) => a.route.localeCompare(b.route)),
    api_endpoints: M.api.map(a => ({ path: a.path, methods: a.methods, file: a.file })).sort((a, b) => a.path.localeCompare(b.path)),
    server_actions: M.actions.sort((a, b) => a.file.localeCompare(b.file)),
    navigation: M.nav,
  })

  w(path.join(KB, "modules", m.id, "components.json"), {
    module: m.id, discovered_at: NOW,
    shared_components: [...M.components].sort(),
    domain_libraries: [...M.services].sort(),
  })

  w(path.join(KB, "modules", m.id, "permissions.json"), {
    module: m.id, discovered_at: NOW,
    permissions: M.permissions.map(p => ({ name: p, ...(M.permission_meta?.[p] || {}) })),
    default_grants: M.default_grants,
    has_seed: M.has_seed,
  })

  index.push({
    name: m.id,
    pages_count: M.pages.length,
    pages: M.pages.map(p => p.route).sort(),
    api_endpoints_count: M.api.length,
    tables_count: modTables.length,
    tables_direct: modTables.filter(t => t.depth <= 1).length,
    permissions_count: M.permissions.length,
    server_action_files: M.actions.length,
    nav_areas: [...new Set((m.nav || []).map(s => s.areaId))],
  })
}

// ---------- relaciones (derivadas de las foreign keys reales) ----------
// Un símbolo puede pertenecer a varios módulos; se le asigna el módulo que lo
// alcanza con menor profundidad de import, y se registran los demás como compartido.
const ownerOf = {}
for (const m of registry) {
  for (const [sym, depth] of mods[m.id].schema_symbols) {
    const cur = ownerOf[sym]
    if (!cur || depth < cur.depth) ownerOf[sym] = { module: m.id, depth, shared: [] }
  }
}
for (const m of registry) for (const [sym] of mods[m.id].schema_symbols) {
  if (ownerOf[sym] && ownerOf[sym].module !== m.id) ownerOf[sym].shared.push(m.id)
}

const fks = []
for (const t of Object.values(tables)) {
  for (const c of t.columns) {
    if (!c.references) continue
    const [targetSym, targetCol] = c.references.split(".")
    const target = tables[targetSym]
    fks.push({
      from: { symbol: t.symbol, table: t.table, column: c.name, module: ownerOf[t.symbol]?.module ?? null },
      to: { symbol: targetSym, table: target?.table ?? null, column: targetCol, module: ownerOf[targetSym]?.module ?? null },
      required: c.not_null,
      on_delete: c.on_delete,
      type: "belongs_to",
    })
  }
}
w(path.join(KB, "relationships", "_foreign-keys.json"), {
  generated_at: NOW,
  source: "columnas con .references() en db/schema",
  count: fks.length,
  note: "module es el módulo que alcanza la tabla con menor profundidad de import; null = ningún módulo del registry la alcanza desde sus páginas o endpoints.",
  foreign_keys: fks.sort((a, b) => a.from.table.localeCompare(b.from.table) || a.from.column.localeCompare(b.from.column)),
})

// Aristas entre módulos distintos: donde un flujo cruza de un módulo a otro.
const pairs = {}
for (const fk of fks) {
  const a = fk.from.module, b = fk.to.module
  if (!a || !b || a === b) continue
  const key = [a, b].sort().join("-")
  ;(pairs[key] ||= { modules: key.split("-"), links: [] }).links.push({
    from_table: fk.from.table, from_column: fk.from.column, from_module: a,
    to_table: fk.to.table, to_module: b, required: fk.required, on_delete: fk.on_delete,
  })
}
for (const [key, val] of Object.entries(pairs)) {
  w(path.join(KB, "relationships", key + ".json"), {
    generated_at: NOW, modules: val.modules, links_count: val.links.length,
    description: `Acoplamiento por foreign key entre los módulos ${val.modules[0]} y ${val.modules[1]}.`,
    links: val.links,
  })
}

w(path.join(KB, "cross-module-flows", "_pending.json"), {
  generated_at: NOW,
  status: "no derivado",
  reason: "Los flujos que cruzan módulos dependen de lógica de negocio (server actions, eventos, estados) que no se infiere de forma fiable solo desde imports y foreign keys.",
  strongest_candidates: Object.entries(pairs)
    .sort((a, b) => b[1].links.length - a[1].links.length).slice(0, 10)
    .map(([, v]) => ({ modules: v.modules, fk_links: v.links.length, hint: `/docs:flow ${v.modules[0]}` })),
  how_to_fill: "Ejecutar /docs:flow <nombre> por flujo, o /docs:explore contra la app en ejecución.",
})

w(path.join(KB, "modules", "_plataforma", "routes.json"), {
  module: "_plataforma",
  discovered_at: NOW,
  note: "Superficie transversal: no pertenece a ningún módulo del registry y no se puede desactivar desde /admin/modulos.",
  pages: shell.pages.map(p => ({ route: p.route, file: p.file, group: p.group, dynamic: /\[/.test(p.route) })).sort((a, b) => a.route.localeCompare(b.route)),
  api_endpoints: shell.api.map(a => ({ path: a.path, methods: a.methods, file: a.file })).sort((a, b) => a.path.localeCompare(b.path)),
})

w(path.join(KB, "_meta", "modules-index.json"), { discovered_at: NOW, source: "modules/registry.ts", modules_count: index.length, modules: index })

w(path.join(KB, "_meta", "stack.json"), {
  discovered_at: NOW,
  frontend: { framework: "Next.js 15 App Router", ui: ["React 19", "Tailwind CSS", "Radix UI", "Recharts", "Phosphor Icons"], path: "app" },
  backend: { runtime: "Node >=22.13 <23", patterns: ["Server Actions", "Route Handlers"], auth: "NextAuth", path: "lib" },
  database: { engine: "PostgreSQL", orm: "Drizzle ORM", schema_dir: "db/schema", migrations_dir: "db/migrations", tables_total: Object.keys(tables).length, enums_total: Object.keys(enums).length },
  testing: ["Vitest", "PGlite", "Playwright"],
  observability: ["Sentry"],
  modularity: { registry: "modules/registry.ts", manifest_type: "modules/manifest-types.ts", toggle_page: "/admin/modulos" },
})

w(path.join(KB, "_meta", "project.json"), {
  analyzed_at: NOW,
  project_name: "Plataforma Chome",
  modules_count: index.length,
  tables_total: Object.keys(tables).length,
  enums_total: Object.keys(enums).length,
  pages_total: pages.length,
  pages_mapped: pages.length - unassignedPages.length - shell.pages.length,
  pages_cross_cutting: shell.pages.length,
  api_endpoints_total: apiRoutes.length,
  api_endpoints_mapped: apiRoutes.length - unassignedApi.length - shell.api.length,
  api_endpoints_cross_cutting: shell.api.length,
  permissions_total: registry.reduce((a, m) => a + m.permissions.length, 0),
  foreign_keys_total: fks.length,
  cross_module_fk_pairs: Object.keys(pairs).length,
  scope_model: "Los datos y la navegación se acotan por faena, por rol y por módulo activo.",
})

w(path.join(KB, "_meta", "warnings.json"), {
  generated_at: NOW,
  unmapped_pages: {
    count: unassignedPages.length,
    note: "Páginas sin prefijo de nav en ningún manifest: rutas públicas, de autenticación, de impresión o transversales.",
    items: unassignedPages.map(p => ({ route: p.route, file: p.file, group: p.group })).sort((a, b) => a.route.localeCompare(b.route)),
  },
  unmapped_api: {
    count: unassignedApi.length,
    note: "Endpoints cuyo prefijo no coincide con la navegación de ningún módulo.",
    items: unassignedApi.map(a => ({ path: a.path, methods: a.methods })).sort((a, b) => a.path.localeCompare(b.path)),
  },
  not_analyzed_yet: [
    "validation.json (reglas Zod) — requiere pasada por módulo: /docs:discover <módulo> --deep",
    "ui-states/ y flows/ — requieren /docs:explore o /docs:flow sobre la app en ejecución",
    "cross-module-flows/ — no derivado; ver cross-module-flows/_pending.json",
  ],
})

console.log(JSON.stringify({
  modules: index.length, tables: Object.keys(tables).length, enums: Object.keys(enums).length,
  pages: pages.length, shell_pages: shell.pages.length, unmapped_pages: unassignedPages.length,
  api: apiRoutes.length, shell_api: shell.api.length, unmapped_api: unassignedApi.length,
  foreign_keys: fks.length, module_pairs: Object.keys(pairs).length,
  checks: Object.values(tables).reduce((a, t) => a + t.checks.length, 0),
  cols_with_allowed_values: Object.values(tables).reduce((a, t) => a + t.columns.filter(c => c.allowed_values).length, 0),
}, null, 2))
