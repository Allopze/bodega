/**
 * Bootstrap seed — Chome Solicitudes y Bodega
 * Creates only system roles, permissions, and base catalog data.
 * Operational/test data should be entered through the app flows.
 * Run with: npx tsx db/seed.ts
 */
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import bcrypt from "bcryptjs"
import { loadEnvConfig } from "@next/env"
import * as schema from "./schema"
import { eq } from "drizzle-orm"

loadEnvConfig(process.cwd())

const DB_URL = process.env.DATABASE_URL ?? "./db/stockflow.db"
const adminName = process.env.SEED_ADMIN_NAME ?? "Administrador"
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@chome.cl").toLowerCase()
const NODE_ENV = process.env.NODE_ENV ?? "development"
const SEED_ALLOW_DEFAULT_PASSWORD = process.env.SEED_ALLOW_DEFAULT_PASSWORD === "true"

function resolveSeedAdminPassword(): string {
  const explicit = process.env.SEED_ADMIN_PASSWORD
  if (explicit && explicit.length > 0) return explicit
  if (NODE_ENV === "production" && !SEED_ALLOW_DEFAULT_PASSWORD) {
    console.error(
      "Refusing to seed: SEED_ADMIN_PASSWORD is not set and NODE_ENV=production.\n" +
      "Define a strong password via SEED_ADMIN_PASSWORD, or set SEED_ALLOW_DEFAULT_PASSWORD=true\n" +
      "to fall back to the development default (chome2026).",
    )
    process.exit(1)
  }
  return "chome2026"
}
const adminPassword = resolveSeedAdminPassword()
const sqlite = new Database(DB_URL)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")
const db = drizzle(sqlite, { schema })

type EppCatalogItem = {
  id: string
  supplierId: string
  sku: string
  name: string
  originalName?: string
  detail: string | null
  price: number | null
  attributes?: EppAttribute[]
}

type EppAttribute = {
  name: string
  value: string
}

const EPP_CATEGORY = {
  id: "cat-epp",
  name: "Elementos de protección personal",
  slug: "epp",
  isEpp: true,
  requiresPrevencion: true,
  sortOrder: 10,
}

const EPP_SUPPLIERS: schema.suppliers["$inferInsert"][] = [
  {
    id: "sup-treck",
    name: "TRECK",
    notes: "Proveedor cargado desde EPP PROVEEDORES.xlsx.",
    isActive: true,
  },
  {
    id: "sup-apro",
    name: "APRO",
    notes: "Proveedor cargado desde EPP PROVEEDORES.xlsx.",
    isActive: true,
  },
]

const attr = (name: string, value: string): EppAttribute => ({ name, value })

const EPP_CATALOG_ITEMS: EppCatalogItem[] = [
  { id: "epp-treck-001", supplierId: "sup-treck", sku: "EPP-TRECK-001", name: "Barbiquejo Gancho Plastico C/Mentonera", detail: null, price: 330 },
  { id: "epp-treck-002", supplierId: "sup-treck", sku: "EPP-TRECK-002", name: "BORDADO ESPALDA", detail: null, price: 1200 },
  { id: "epp-treck-003", supplierId: "sup-treck", sku: "EPP-TRECK-003", name: "Bota PVC Segusa Pegasus C/P y Plantilla", originalName: "Bota Pvc Segusa Pegasus C/P y Plantiilla T-41", detail: null, price: 8520, attributes: [attr("Talla", "41")] },
  { id: "epp-treck-004", supplierId: "sup-treck", sku: "EPP-TRECK-004", name: "Botin V-Flex Thinsulate", originalName: "BOTIN V-FLEX THINSULATE  V15 NEGRO/AZUL  N", detail: "LINEA MANDO", price: 49900, attributes: [attr("Modelo", "V15"), attr("Color", "Negro/Azul")] },
  { id: "epp-treck-005", supplierId: "sup-treck", sku: "EPP-TRECK-005", name: "Botin V-Flex Microfiber", originalName: "BOTIN V-FLEX V73 MICROFIBER NEGRO", detail: "personal", price: 39900, attributes: [attr("Modelo", "V73"), attr("Color", "Negro")] },
  { id: "epp-treck-006", supplierId: "sup-treck", sku: "EPP-TRECK-006", name: "Botin V-Flex Mujer Nobuck", originalName: "Botin V-Flex V5  Mujer Nobuck Café - T37", detail: null, price: 36000, attributes: [attr("Modelo", "V5"), attr("Color", "Café"), attr("Talla", "37")] },
  { id: "epp-treck-007", supplierId: "sup-treck", sku: "EPP-TRECK-007", name: "Botiquin Activex de Primeros Auxilios 10 Personas", detail: null, price: 4600 },
  { id: "epp-treck-008", supplierId: "sup-treck", sku: "EPP-TRECK-008", name: "Buzo Dupont Tyvek", originalName: "Buzo Dupont Tyvek 500X Blanco", detail: null, price: 4100, attributes: [attr("Modelo", "500X"), attr("Color", "Blanco")] },
  { id: "epp-treck-009", supplierId: "sup-treck", sku: "EPP-TRECK-009", name: "Blusa Absolute Zero Lightwind Poliéster", originalName: "BLUSA ABSOLUTE ZERO LIGHTWIND W2400 POLIESTER AZUL MARINO T-XL", detail: "LINEA MANDO", price: 12900, attributes: [attr("Modelo", "W2400"), attr("Color", "Azul marino"), attr("Talla", "XL")] },
  { id: "epp-treck-010", supplierId: "sup-treck", sku: "EPP-TRECK-010", name: "Camisa Absolute Zero Lightwind Poliéster", originalName: "CAMISA ABSOLUTE ZERO LIGHTWIND H2600 POLIESTER AZUL MARINO T-3XL", detail: "LINEA MANDO", price: 12900, attributes: [attr("Modelo", "H2600"), attr("Color", "Azul marino"), attr("Talla", "3XL")] },
  { id: "epp-treck-011", supplierId: "sup-treck", sku: "EPP-TRECK-011", name: "Capa PVC c/cinta reflectante", originalName: "Capa PVC Azul c/cinta reflectante talla única", detail: null, price: 4200, attributes: [attr("Color", "Azul"), attr("Talla", "Única")] },
  { id: "epp-treck-012", supplierId: "sup-treck", sku: "EPP-TRECK-012", name: "Casco Activex I Arnes cinta 6 Puntas Ratchet", originalName: "Casco Activex I Gris Arnes cinta 6 Puntas Ratchet", detail: null, price: 2160, attributes: [attr("Color", "Gris")] },
  { id: "epp-treck-013", supplierId: "sup-treck", sku: "EPP-TRECK-013", name: "Casquete ABS Porta Visor", originalName: "Casquete ABS Porta Visor Amarillo", detail: "Soldador", price: 1450, attributes: [attr("Color", "Amarillo")] },
  { id: "epp-treck-014", supplierId: "sup-treck", sku: "EPP-TRECK-014", name: "Chaleco Geologo Activex Gabardina Terra Bicolor", originalName: "CHALECO GEOLOGO ACTIVEX GABARDINA TERRA BICOLOR AMARILLO", detail: "BORDADO ESPALDA", price: 9400, attributes: [attr("Color", "Amarillo")] },
  { id: "epp-treck-015", supplierId: "sup-treck", sku: "EPP-TRECK-015", name: "Chaqueta Activex Micropolar manga larga", originalName: "Chaqueta activex  micropolar negro manga larga talla", detail: null, price: 7900, attributes: [attr("Color", "Negro")] },
  { id: "epp-treck-016", supplierId: "sup-treck", sku: "EPP-TRECK-016", name: "Coleto Activex Soldador Cuero Tr.", detail: null, price: 5800 },
  { id: "epp-treck-017", supplierId: "sup-treck", sku: "EPP-TRECK-017", name: "Filtro Activex vapores orgánicos y gases ácidos", originalName: "Filtro Activex ATX VO/GA350 Vapores Organicos y Gases Acidos A1E1 (Par)", detail: "BIODIVERSA", price: 5700, attributes: [attr("Modelo", "ATX VO/GA350"), attr("Tipo", "A1E1"), attr("Presentación", "Par")] },
  { id: "epp-treck-018", supplierId: "sup-treck", sku: "EPP-TRECK-018", name: "Fono HL Verishield cintillo", originalName: "Fono HL Verishield VS120 cintillo SNR 31 dB", detail: null, price: 12500, attributes: [attr("Modelo", "VS120"), attr("Atenuación", "SNR 31 dB")] },
  { id: "epp-treck-019", supplierId: "sup-treck", sku: "EPP-TRECK-019", name: "Fono HL Verishield p/casco dieléctrico", originalName: "Fono HL Verishield VS120DH p/casco Dielec SNR 31 dB 1035201", detail: null, price: 12200, attributes: [attr("Modelo", "VS120DH"), attr("Código", "1035201"), attr("Atenuación", "SNR 31 dB")] },
  { id: "epp-treck-020", supplierId: "sup-treck", sku: "EPP-TRECK-020", name: "Gorro Legionario Activex", originalName: "GORRO LEGIONARIO BEIGE ACTIVEX", detail: null, price: 1880, attributes: [attr("Color", "Beige")] },
  { id: "epp-treck-021", supplierId: "sup-treck", sku: "EPP-TRECK-021", name: "Guante Activex Cabritilla Largo Electricista", detail: "santa fe", price: 1530 },
  { id: "epp-treck-022", supplierId: "sup-treck", sku: "EPP-TRECK-022", name: "Guante Activex Nitrilo Heavy Duty puño seguridad", originalName: "GUANTE ACTIVEX NITRILO HEAVY DUTY PUNO ROJO SEGURIDAD T-L", detail: "BIODIVERSA", price: 1900, attributes: [attr("Color", "Rojo"), attr("Talla", "L")] },
  { id: "epp-treck-023", supplierId: "sup-treck", sku: "EPP-TRECK-023", name: "Guante Activex PVC", originalName: "GUANTE ACTIVEX PVC ROJO 14-35", detail: "cabrero", price: 1200, attributes: [attr("Color", "Rojo"), attr("Medida", "14-35")] },
  { id: "epp-treck-024", supplierId: "sup-treck", sku: "EPP-TRECK-024", name: "Guante Cabritilla Activex con Forro", detail: null, price: 1150 },
  { id: "epp-treck-025", supplierId: "sup-treck", sku: "EPP-TRECK-025", name: "Guante Cabritilla Activex sin forro gris", detail: null, price: 930 },
  { id: "epp-treck-026", supplierId: "sup-treck", sku: "EPP-TRECK-026", name: "Guante Nitrilo Showa", originalName: "Guante Nitrilo Showa 720 1.1Mm 30 Cm. Tr. T-L", detail: "DE PRUEBA", price: 3490, attributes: [attr("Modelo", "720"), attr("Espesor", "1.1 mm"), attr("Largo", "30 cm"), attr("Talla", "L")] },
  { id: "epp-treck-027", supplierId: "sup-treck", sku: "EPP-TRECK-027", name: "Lente Activex sellado", originalName: "Lente Activex FX III sellado In out", detail: null, price: 2240, attributes: [attr("Modelo", "FX III"), attr("Color", "In/Out")] },
  { id: "epp-treck-028", supplierId: "sup-treck", sku: "EPP-TRECK-028", name: "Mascarilla plegable KN95 sin válvula", originalName: "MASCARILLA PLEGABLE KN 95 SIN VALVULA (10 UN)", detail: null, price: 600, attributes: [attr("Presentación", "10 unidades")] },
  { id: "epp-treck-029", supplierId: "sup-treck", sku: "EPP-TRECK-029", name: "Overol Activex Piloto Poplin c/reflectante", originalName: "Overol Activex Piloto Poplin Azul  C/ Reflectante T-XXXL", detail: "CON LOGO", price: 5500, attributes: [attr("Color", "Azul"), attr("Talla", "XXXL")] },
  { id: "epp-treck-030", supplierId: "sup-treck", sku: "EPP-TRECK-030", name: "Pantalón Lightwind nylon spandex mujer UV", originalName: "PANTALON LIGHTWIND W3000 NYLON SPANDEX MUJER BEIGE UV T-XL", detail: "LINEA MANDO", price: 26400, attributes: [attr("Modelo", "W3000"), attr("Género", "Mujer"), attr("Color", "Beige"), attr("Talla", "XL")] },
  { id: "epp-treck-031", supplierId: "sup-treck", sku: "EPP-TRECK-031", name: "Pantalón Lightwind nylon spandex hombre UV", originalName: "PANTALON LIGHTWIND H3200 NYLON SPANDEXHOMBRE BEIGE UV T-2XL", detail: "LINEA MANDO", price: 26400, attributes: [attr("Modelo", "H3200"), attr("Género", "Hombre"), attr("Color", "Beige"), attr("Talla", "2XL")] },
  { id: "epp-treck-032", supplierId: "sup-treck", sku: "EPP-TRECK-032", name: "Pantalón slack cargo gabardina con logo", originalName: "PANTALON SLACK CARGO GABARDINA GRIS/NARANJO con logo", detail: null, price: 11500, attributes: [attr("Color", "Gris/Naranjo")] },
  { id: "epp-treck-033", supplierId: "sup-treck", sku: "EPP-TRECK-033", name: "Primera Capa Activex polyester", originalName: "Primera Capa Activex polyester Negro T- 2XL", detail: null, price: 4700, attributes: [attr("Color", "Negro"), attr("Talla", "2XL")] },
  { id: "epp-treck-034", supplierId: "sup-treck", sku: "EPP-TRECK-034", name: "Respirador Activex TPR medio rostro", originalName: "Respirador Activex TPR ATX 100  (medio rostro)", detail: "BIODIVERSA", price: 3500, attributes: [attr("Modelo", "ATX 100")] },
  { id: "epp-treck-035", supplierId: "sup-treck", sku: "EPP-TRECK-035", name: "Traje para Lluvia Activex color", detail: null, price: 7100 },
  { id: "epp-treck-036", supplierId: "sup-treck", sku: "EPP-TRECK-036", name: "Traje PU Activex Pantalón", originalName: "Traje PU Verde Activex Pantalón T-L", detail: null, price: 13900, attributes: [attr("Color", "Verde"), attr("Talla", "L")] },
  { id: "epp-treck-037", supplierId: "sup-treck", sku: "EPP-TRECK-037", name: "Alta Visibilidad C/Cinta", originalName: "verde Alta Visibilidad C/Cinta", detail: "Registro sin valor informado en EPP PROVEEDORES.xlsx.", price: null, attributes: [attr("Color", "Verde")] },
  { id: "epp-treck-038", supplierId: "sup-treck", sku: "EPP-TRECK-038", name: "Visor Activex Policarbornato C/Porta Visor Control de Residu", detail: "personal", price: 5100 },
  { id: "epp-treck-039", supplierId: "sup-treck", sku: "EPP-TRECK-039", name: "Visor Claro Borde Aluminio", originalName: "Visor Claro 8 x 16 Borde Aluminio", detail: "Soldador", price: 1050, attributes: [attr("Medida", "8 x 16")] },
  { id: "epp-treck-040", supplierId: "sup-treck", sku: "EPP-TRECK-040", name: "Antiparra y Lente MSA Ductile Wings", originalName: "Antiparra y Lente MSA Ductile. Wings In/Out 2803154", detail: "MININCO", price: 11200, attributes: [attr("Color", "In/Out"), attr("Modelo", "2803154")] },
  { id: "epp-apro-001", supplierId: "sup-apro", sku: "EPP-APRO-001", name: "Botin Norseg Greta CT", originalName: "BOTIN NORSEG GRETA CT DAMA GRIS", detail: null, price: 57513, attributes: [attr("Género", "Dama"), attr("Color", "Gris")] },
  { id: "epp-apro-002", supplierId: "sup-apro", sku: "EPP-APRO-002", name: "Respirador MSA de escape Miniescape", detail: null, price: 30900 },
  { id: "epp-apro-003", supplierId: "sup-apro", sku: "EPP-APRO-003", name: "ESTUCHE TACTICO P/DESCONTAMINADOR EN SPRAY", detail: null, price: 16000 },
  { id: "epp-apro-004", supplierId: "sup-apro", sku: "EPP-APRO-004", name: "ESTUCHE PORTA MINIESCAPE", detail: null, price: 5900 },
  { id: "epp-apro-005", supplierId: "sup-apro", sku: "EPP-APRO-005", name: "Polera Polo Dryfresh", originalName: "POLERA POLO DRYFRESH DAMA COLOR AZUL PIEDRA", detail: null, price: 6250, attributes: [attr("Género", "Dama"), attr("Color", "Azul piedra")] },
  { id: "epp-apro-006", supplierId: "sup-apro", sku: "EPP-APRO-006", name: "Polera Polo Dryfresh", originalName: "POLERA POLO DRYFRESH HOMBRE COLOR AZUL PIEDRA", detail: null, price: 6250, attributes: [attr("Género", "Hombre"), attr("Color", "Azul piedra")] },
  { id: "epp-apro-007", supplierId: "sup-apro", sku: "EPP-APRO-007", name: "Botin Proflex aislante antiácido", originalName: "BOTIN PROFLEX 125CDPH CMZ AISLANTE ANTIACIDO CAFE N°40", detail: null, price: 40900, attributes: [attr("Modelo", "125CDPH CMZ"), attr("Color", "Café"), attr("Talla", "40")] },
  { id: "epp-apro-008", supplierId: "sup-apro", sku: "EPP-APRO-008", name: "ALCOTEST DIGITAL MARS", detail: null, price: 152990 },
  { id: "epp-apro-009", supplierId: "sup-apro", sku: "EPP-APRO-009", name: "Boquillas Mars-Satellite", originalName: "BOQUILLAS MARS-SATELLITE (BL 100 UN)", detail: null, price: 28900, attributes: [attr("Presentación", "BL 100 unidades")] },
  { id: "epp-apro-010", supplierId: "sup-apro", sku: "EPP-APRO-010", name: "ANPHOTEROL CARA/MANOS 200ml", detail: null, price: 92900 },
  { id: "epp-apro-011", supplierId: "sup-apro", sku: "EPP-APRO-011", name: "Bota Proflex Soldador", originalName: "BOTA PROFLEX 111 SOLDADOR NEGRO N°41", detail: null, price: 57749, attributes: [attr("Modelo", "111"), attr("Color", "Negro"), attr("Talla", "41")] },
  { id: "epp-apro-012", supplierId: "sup-apro", sku: "EPP-APRO-012", name: "Buzo Tyvek Xpert", originalName: "BUZO TYVEK@500 XPERT TY198S XL", detail: "coti CO-145636", price: 3790, attributes: [attr("Modelo", "TY198S"), attr("Talla", "XL")] },
  { id: "epp-apro-013", supplierId: "sup-apro", sku: "EPP-APRO-013", name: "Guante nitrilo texturizado", originalName: "GUANTE NITRILO TEXTURIZADO 8,0 GR NARANJO T/ L (CJ 50 UN)", detail: "stafe", price: 7900, attributes: [attr("Color", "Naranjo"), attr("Talla", "L"), attr("Gramaje", "8,0 gr"), attr("Presentación", "Caja 50 unidades")] },
]

function sourceNote(item: EppCatalogItem) {
  const parts = [
    "Fuente: EPP PROVEEDORES.xlsx.",
    `Proveedor original: ${item.supplierId === "sup-treck" ? "TRECK" : "APRO"}.`,
  ]
  if (item.originalName) parts.push(`Nombre original: ${item.originalName}.`)
  if (item.detail) parts.push(`Detalle / Nota: ${item.detail}`)
  return parts.join(" ")
}

async function main() {
  console.log("Inicializando datos base de Chome Solicitudes y Bodega...")

  /* ── Roles ────────────────────────────────────────────────────────────── */
  const roleData: schema.roles["$inferInsert"][] = [
    { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total técnico del sistema" },
    { id: "rol-jefa", name: "jefa_chome", label: "Jefa Chome", description: "Revisa, aprueba y administra la operación" },
    { id: "rol-sec", name: "secretaria", label: "Secretaria", description: "Revisa, aprueba y gestiona operación diaria" },
    { id: "rol-prev", name: "prevencionista", label: "Prevencionista", description: "Revisa y aprueba solicitudes" },
    { id: "rol-sol-faena", name: "solicitante_faena", label: "Solicitante de faena", description: "Solicita ítems para sus faenas asignadas" },
  ]
  for (const role of roleData) {
    await db.insert(schema.roles).values(role).onConflictDoUpdate({
      target: schema.roles.id,
      set: {
        name: role.name,
        label: role.label,
        description: role.description ?? null,
      },
    })
  }

  /* ── Permissions ─────────────────────────────────────────────────────── */
  const perms: schema.permissions["$inferInsert"][] = [
    // Requests
    { id: "p-req-create",     name: "requests:create",              module: "requests",   description: "Crear solicitudes" },
    { id: "p-req-own",        name: "requests:view_own",            module: "requests",   description: "Ver solicitudes propias" },
    { id: "p-req-all",        name: "requests:view_all",            module: "requests",   description: "Ver todas las solicitudes" },
    { id: "p-req-submit",     name: "requests:submit",              module: "requests",   description: "Enviar solicitudes a aprobación" },
    // Approvals
    { id: "p-apr",            name: "approvals:approve",            module: "approvals",  description: "Revisar y aprobar solicitudes" },
    // Purchasing
    { id: "p-pur-view",       name: "purchasing:view",              module: "purchasing", description: "Ver módulo de compras" },
    { id: "p-pur-create",     name: "purchasing:create_order",      module: "purchasing", description: "Crear órdenes de compra" },
    { id: "p-pur-send",       name: "purchasing:send_order",        module: "purchasing", description: "Enviar OC a proveedor" },
    { id: "p-pur-sup",        name: "purchasing:manage_suppliers",  module: "purchasing", description: "Administrar proveedores" },
    // Receiving
    { id: "p-rec-reg",        name: "receiving:register",           module: "receiving",  description: "Registrar recepciones" },
    { id: "p-rec-view",       name: "receiving:view",               module: "receiving",  description: "Ver recepciones" },
    // Warehouse
    { id: "p-wh-stock",       name: "warehouse:view_stock",         module: "warehouse",  description: "Ver stock" },
    { id: "p-wh-mov",         name: "warehouse:register_movement",  module: "warehouse",  description: "Registrar movimientos" },
    { id: "p-wh-adj",         name: "warehouse:adjust_stock",       module: "warehouse",  description: "Ajustar stock" },
    // Invoice attachments
    { id: "p-inv-att",        name: "invoice_attachments:manage",   module: "attachments", description: "Anexar facturas a solicitudes y OC" },
    // Reports
    { id: "p-rep-view",       name: "reports:view",                 module: "reports",    description: "Ver reportes y matriz de trazabilidad" },
    // Admin
    { id: "p-adm-usr",        name: "admin:users",                  module: "admin",      description: "Gestionar usuarios" },
    { id: "p-adm-ws",         name: "admin:worksites",              module: "admin",      description: "Gestionar faenas" },
    { id: "p-adm-wrk",        name: "admin:workers",                module: "admin",      description: "Gestionar trabajadores" },
    { id: "p-adm-prod",       name: "admin:products",               module: "admin",      description: "Gestionar catálogo" },
    { id: "p-adm-sup",        name: "admin:suppliers",              module: "admin",      description: "Gestionar proveedores" },
    { id: "p-adm-cfg",        name: "admin:config",                 module: "admin",      description: "Configuración del sistema" },
    { id: "p-adm-audit",      name: "admin:audit_log",              module: "admin",      description: "Ver log de auditoría" },
  ]
  for (const permission of perms) {
    await db.insert(schema.permissions).values(permission).onConflictDoUpdate({
      target: schema.permissions.id,
      set: {
        name: permission.name,
        module: permission.module,
        description: permission.description ?? null,
      },
    })
  }

  const keepRoleIds = roleData.map((r) => r.id)
  const keepPermIds = perms.map((p) => p.id)
  sqlite.prepare("delete from role_permissions").run()
  sqlite.prepare(`delete from user_roles where role_id not in (${keepRoleIds.map(() => "?").join(",")})`).run(...keepRoleIds)
  sqlite.prepare(`delete from roles where id not in (${keepRoleIds.map(() => "?").join(",")})`).run(...keepRoleIds)
  sqlite.prepare(`delete from permissions where id not in (${keepPermIds.map(() => "?").join(",")})`).run(...keepPermIds)

  /* ── Role → Permission mapping ───────────────────────────────────────── */
  const rp = (roleId: string, permId: string) => ({ roleId, permissionId: permId })
  const leadership = [
    "p-req-create", "p-req-own", "p-req-all", "p-req-submit",
    "p-apr",
    "p-pur-view", "p-pur-create", "p-pur-send", "p-pur-sup",
    "p-rec-reg", "p-rec-view",
    "p-wh-stock", "p-wh-mov", "p-wh-adj",
    "p-inv-att",
    "p-rep-view",
    "p-adm-usr", "p-adm-ws", "p-adm-wrk", "p-adm-prod", "p-adm-sup", "p-adm-cfg", "p-adm-audit",
  ]
  const rolePermData = [
    ...perms.map((p) => rp("rol-admin", p.id)),
    ...leadership.map((permId) => rp("rol-jefa", permId)),
    ...leadership.map((permId) => rp("rol-sec", permId)),
    rp("rol-prev", "p-req-all"), rp("rol-prev", "p-apr"), rp("rol-prev", "p-rep-view"),
    rp("rol-sol-faena", "p-req-create"), rp("rol-sol-faena", "p-req-own"), rp("rol-sol-faena", "p-req-submit"),
  ]
  await db.insert(schema.rolePermissions).values(rolePermData)

  /* ── Initial administrator ───────────────────────────────────────────── */
  const existingAdmin = await db.query.users.findFirst({
    where: eq(schema.users.email, adminEmail),
  })
  const adminId = existingAdmin?.id ?? "user-admin"
  const hashedPassword = await bcrypt.hash(adminPassword, 12)

  if (existingAdmin) {
    await db.update(schema.users).set({
      name: adminName,
      hashedPassword,
      isActive: true,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.users.id, adminId))
  } else {
    await db.insert(schema.users).values({
      id: adminId,
      name: adminName,
      email: adminEmail,
      hashedPassword,
      avatarColor: "160",
      isActive: true,
    })
  }

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId))
  await db.insert(schema.userRoles).values({ userId: adminId, roleId: "rol-admin" })

  /* ── EPP catalog from supplier spreadsheet ───────────────────────────── */
  await db.insert(schema.productCategories).values(EPP_CATEGORY).onConflictDoUpdate({
    target: schema.productCategories.id,
    set: {
      name: EPP_CATEGORY.name,
      slug: EPP_CATEGORY.slug,
      isEpp: EPP_CATEGORY.isEpp,
      requiresPrevencion: EPP_CATEGORY.requiresPrevencion,
      sortOrder: EPP_CATEGORY.sortOrder,
    },
  })

  for (const supplier of EPP_SUPPLIERS) {
    await db.insert(schema.suppliers).values(supplier).onConflictDoUpdate({
      target: schema.suppliers.id,
      set: {
        name: supplier.name,
        notes: supplier.notes ?? null,
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  for (const item of EPP_CATALOG_ITEMS) {
    const attributeRows = item.attributes?.map((a, i) => ({
      id: `pa-${item.id}-${i + 1}`,
      productId: item.id,
      categoryId: null,
      name: a.name,
      type: "select",
      isRequired: true,
      options: JSON.stringify([a.value]),
      sortOrder: i,
    })) ?? []

    await db.insert(schema.products).values({
      id: item.id,
      sku: item.sku,
      name: item.name,
      description: item.detail,
      categoryId: EPP_CATEGORY.id,
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: true,
      referencePrice: item.price,
      isActive: true,
      notes: sourceNote(item),
    }).onConflictDoUpdate({
      target: schema.products.id,
      set: {
        sku: item.sku,
        name: item.name,
        description: item.detail,
        categoryId: EPP_CATEGORY.id,
        unitOfMeasure: "unidad",
        isEpp: true,
        requiresPrevencion: true,
        referencePrice: item.price,
        isActive: true,
        notes: sourceNote(item),
        updatedAt: new Date().toISOString(),
      },
    })

    await db.delete(schema.productAttributes).where(eq(schema.productAttributes.productId, item.id))
    if (attributeRows.length > 0) {
      await db.insert(schema.productAttributes).values(attributeRows)
    }

    await db.insert(schema.productSuppliers).values({
      id: `ps-${item.id}`,
      productId: item.id,
      supplierId: item.supplierId,
      unitPrice: item.price,
      isPreferred: true,
      notes: item.detail,
    }).onConflictDoUpdate({
      target: schema.productSuppliers.id,
      set: {
        productId: item.id,
        supplierId: item.supplierId,
        unitPrice: item.price,
        isPreferred: true,
        notes: item.detail,
        lastUpdated: new Date().toISOString(),
      },
    })
  }

  console.log("Seed base completado.")
  console.log("")
  console.log("  Usuario administrador:")
  console.log(`    ${adminEmail}`)
  console.log("")
  console.log("  La contraseña viene de SEED_ADMIN_PASSWORD; si no se define, usa chome2026.")
  console.log(`  Catálogo EPP cargado: ${EPP_CATALOG_ITEMS.length} productos, ${EPP_SUPPLIERS.length} proveedores.`)
  console.log("  No se cargaron faenas, stock ni solicitudes demo.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => sqlite.close())
