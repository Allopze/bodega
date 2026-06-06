/**
 * Seed file — Chome StockFlow
 * Realistic Chilean data. No "John Doe", no round numbers, no predictable fake values.
 * Run with: npx tsx db/seed.ts
 */
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"
import bcrypt from "bcryptjs"

const DB_URL = process.env.DATABASE_URL ?? "./db/stockflow.db"
const sqlite = new Database(DB_URL)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")
const db = drizzle(sqlite, { schema })

async function main() {
  console.log("🌱 Iniciando seed Chome StockFlow…")

  /* ── Roles ────────────────────────────────────────────────────────────── */
  const roleData: schema.roles["$inferInsert"][] = [
    { id: "rol-admin",    name: "administrador",  label: "Administrador",     description: "Control total del sistema" },
    { id: "rol-sol",      name: "solicitante",    label: "Solicitante",       description: "Crea solicitudes de compra desde faena" },
    { id: "rol-jefe",     name: "jefe_faena",     label: "Jefe de faena",     description: "Aprueba solicitudes de su faena" },
    { id: "rol-prev",     name: "prevencion",     label: "Prevención",        description: "Aprueba ítems de seguridad y EPP" },
    { id: "rol-compras",  name: "compras",        label: "Compras",           description: "Genera órdenes de compra" },
    { id: "rol-rec",      name: "recepcion",      label: "Recepción/Bodega",  description: "Registra recepciones y maneja stock" },
    { id: "rol-fin",      name: "finanzas",       label: "Finanzas",          description: "Registra y concilia facturas" },
    { id: "rol-ger",      name: "gerencia",       label: "Gerencia",          description: "Vista ejecutiva y reportes" },
  ]
  await db.insert(schema.roles).values(roleData).onConflictDoNothing()

  /* ── Permissions ─────────────────────────────────────────────────────── */
  const perms: schema.permissions["$inferInsert"][] = [
    // Requests
    { id: "p-req-create",     name: "requests:create",              module: "requests",   description: "Crear solicitudes" },
    { id: "p-req-own",        name: "requests:view_own",            module: "requests",   description: "Ver solicitudes propias" },
    { id: "p-req-all",        name: "requests:view_all",            module: "requests",   description: "Ver todas las solicitudes" },
    { id: "p-req-submit",     name: "requests:submit",              module: "requests",   description: "Enviar solicitudes a aprobación" },
    // Approvals
    { id: "p-apr-faena",      name: "approvals:approve_faena",      module: "approvals",  description: "Aprobar como jefe de faena" },
    { id: "p-apr-prev",       name: "approvals:approve_prevencion", module: "approvals",  description: "Aprobar como prevención" },
    { id: "p-apr-admin",      name: "approvals:approve_admin",      module: "approvals",  description: "Aprobar como administrador" },
    // Purchasing
    { id: "p-pur-view",       name: "purchasing:view",              module: "purchasing", description: "Ver módulo de compras" },
    { id: "p-pur-create",     name: "purchasing:create_order",      module: "purchasing", description: "Crear órdenes de compra" },
    { id: "p-pur-send",       name: "purchasing:send_order",        module: "purchasing", description: "Enviar OC a proveedor" },
    { id: "p-pur-sup",        name: "purchasing:manage_suppliers",  module: "purchasing", description: "Administrar proveedores" },
    // Receiving
    { id: "p-rec-reg",        name: "receiving:register",           module: "receiving",  description: "Registrar recepciones" },
    { id: "p-rec-view",       name: "receiving:view",               module: "receiving",  description: "Ver recepciones" },
    // Delivery
    { id: "p-del-reg",        name: "delivery:register",            module: "delivery",   description: "Registrar entregas" },
    { id: "p-del-view",       name: "delivery:view",                module: "delivery",   description: "Ver entregas" },
    // Warehouse
    { id: "p-wh-stock",       name: "warehouse:view_stock",         module: "warehouse",  description: "Ver stock" },
    { id: "p-wh-mov",         name: "warehouse:register_movement",  module: "warehouse",  description: "Registrar movimientos" },
    { id: "p-wh-adj",         name: "warehouse:adjust_stock",       module: "warehouse",  description: "Ajustar stock" },
    // Invoicing
    { id: "p-inv-reg",        name: "invoicing:register",           module: "invoicing",  description: "Registrar facturas" },
    { id: "p-inv-rec",        name: "invoicing:reconcile",          module: "invoicing",  description: "Conciliar facturas" },
    { id: "p-inv-view",       name: "invoicing:view",               module: "invoicing",  description: "Ver facturas" },
    // Reports
    { id: "p-rep-ops",        name: "reports:view_operational",     module: "reports",    description: "Ver reportes operativos" },
    { id: "p-rep-mgmt",       name: "reports:view_management",      module: "reports",    description: "Ver reportes de gestión" },
    { id: "p-rep-exp",        name: "reports:export",               module: "reports",    description: "Exportar datos" },
    // Admin
    { id: "p-adm-usr",        name: "admin:users",                  module: "admin",      description: "Gestionar usuarios" },
    { id: "p-adm-ws",         name: "admin:worksites",              module: "admin",      description: "Gestionar faenas" },
    { id: "p-adm-prod",       name: "admin:products",               module: "admin",      description: "Gestionar catálogo" },
    { id: "p-adm-sup",        name: "admin:suppliers",              module: "admin",      description: "Gestionar proveedores" },
    { id: "p-adm-cfg",        name: "admin:config",                 module: "admin",      description: "Configuración del sistema" },
    { id: "p-adm-audit",      name: "admin:audit_log",              module: "admin",      description: "Ver log de auditoría" },
  ]
  await db.insert(schema.permissions).values(perms).onConflictDoNothing()

  /* ── Role → Permission mapping ───────────────────────────────────────── */
  const rp = (roleId: string, permId: string) => ({ roleId, permissionId: permId })
  const rolePermData = [
    // Administrador — all
    ...perms.map((p) => rp("rol-admin", p.id)),
    // Solicitante
    rp("rol-sol", "p-req-create"), rp("rol-sol", "p-req-own"), rp("rol-sol", "p-req-submit"),
    // Jefe de faena
    rp("rol-jefe", "p-req-all"), rp("rol-jefe", "p-apr-faena"),
    rp("rol-jefe", "p-rep-ops"), rp("rol-jefe", "p-del-view"),
    // Prevención
    rp("rol-prev", "p-req-all"), rp("rol-prev", "p-apr-prev"),
    rp("rol-prev", "p-del-view"), rp("rol-prev", "p-rep-ops"),
    // Compras — also gets approve_faena so the secretaria can approve as backstop
    rp("rol-compras", "p-req-all"),   rp("rol-compras", "p-apr-faena"),
    rp("rol-compras", "p-pur-view"),  rp("rol-compras", "p-pur-create"),
    rp("rol-compras", "p-pur-send"),  rp("rol-compras", "p-pur-sup"),
    rp("rol-compras", "p-rep-ops"),   rp("rol-compras", "p-adm-sup"),
    // Recepción/Bodega
    rp("rol-rec", "p-rec-reg"), rp("rol-rec", "p-rec-view"),
    rp("rol-rec", "p-del-reg"), rp("rol-rec", "p-del-view"),
    rp("rol-rec", "p-wh-stock"), rp("rol-rec", "p-wh-mov"),
    rp("rol-rec", "p-rep-ops"),
    // Finanzas
    rp("rol-fin", "p-inv-reg"), rp("rol-fin", "p-inv-rec"), rp("rol-fin", "p-inv-view"),
    rp("rol-fin", "p-rep-ops"), rp("rol-fin", "p-rep-mgmt"), rp("rol-fin", "p-rep-exp"),
    // Gerencia
    rp("rol-ger", "p-req-all"), rp("rol-ger", "p-pur-view"),
    rp("rol-ger", "p-inv-view"), rp("rol-ger", "p-wh-stock"),
    rp("rol-ger", "p-rep-ops"), rp("rol-ger", "p-rep-mgmt"), rp("rol-ger", "p-rep-exp"),
  ]
  await db.insert(schema.rolePermissions).values(rolePermData).onConflictDoNothing()

  /* ── Users ───────────────────────────────────────────────────────────── */
  const pw = await bcrypt.hash("chome2026", 12)
  const users: schema.users["$inferInsert"][] = [
    { id: "u-admin",    name: "Marcela Cisternas",    email: "admin@chome.cl",       hashedPassword: pw, avatarColor: "151" },
    { id: "u-sol1",     name: "Diego Sepúlveda",      email: "dsepulveda@chome.cl",  hashedPassword: pw, avatarColor: "210" },
    { id: "u-sol2",     name: "Fernanda Quiñones",    email: "fquinones@chome.cl",   hashedPassword: pw, avatarColor: "320" },
    { id: "u-jefe1",    name: "Rodrigo Fuentes",      email: "rfuentes@chome.cl",    hashedPassword: pw, avatarColor: "185" },
    { id: "u-jefe2",    name: "Camila Araya",         email: "caraya@chome.cl",      hashedPassword: pw, avatarColor: "55"  },
    { id: "u-prev1",    name: "Eduardo Paredes",      email: "eparedes@chome.cl",    hashedPassword: pw, avatarColor: "30"  },
    { id: "u-compras1", name: "Javiera Molina",       email: "jmolina@chome.cl",     hashedPassword: pw, avatarColor: "270" },
    { id: "u-rec1",     name: "Patricio Vega",        email: "pvega@chome.cl",       hashedPassword: pw, avatarColor: "125" },
    { id: "u-fin1",     name: "Lorena Muñoz",         email: "lmunoz@chome.cl",      hashedPassword: pw, avatarColor: "240" },
    { id: "u-ger1",     name: "Andrés Contreras",     email: "acontreras@chome.cl",  hashedPassword: pw, avatarColor: "60"  },
  ]
  await db.insert(schema.users).values(users).onConflictDoNothing()

  /* ── User roles ──────────────────────────────────────────────────────── */
  const urData = [
    { userId: "u-admin",    roleId: "rol-admin"   },
    { userId: "u-sol1",     roleId: "rol-sol"     },
    { userId: "u-sol2",     roleId: "rol-sol"     },
    { userId: "u-jefe1",    roleId: "rol-jefe"    },
    { userId: "u-jefe2",    roleId: "rol-jefe"    },
    { userId: "u-prev1",    roleId: "rol-prev"    },
    { userId: "u-compras1", roleId: "rol-compras" },
    { userId: "u-rec1",     roleId: "rol-rec"     },
    { userId: "u-fin1",     roleId: "rol-fin"     },
    { userId: "u-ger1",     roleId: "rol-ger"     },
  ]
  await db.insert(schema.userRoles).values(urData).onConflictDoNothing()

  /* ── Worksites (Faenas) ─────────────────────────────────────────────── */
  const worksiteData: schema.worksites["$inferInsert"][] = [
    { id: "ws-norte", name: "Faena Atacama Norte", code: "FAN-001", address: "Ruta 5 Norte km 847", region: "Antofagasta" },
    { id: "ws-sur",   name: "Faena Biobío Sur",    code: "FBS-001", address: "Camino Forestal s/n",  region: "Biobío"     },
    { id: "ws-metro", name: "Planta Metropolitana", code: "PLM-001", address: "Av. Américo Vespucio 4821, Quilicura", region: "Metropolitana" },
  ]
  await db.insert(schema.worksites).values(worksiteData).onConflictDoNothing()

  /* ── Cost Centers ───────────────────────────────────────────────────── */
  const ccData: schema.costCenters["$inferInsert"][] = [
    { id: "cc-1", name: "Operaciones Norte",       code: "CC-OPN-001", worksiteId: "ws-norte" },
    { id: "cc-2", name: "Mantenimiento Norte",     code: "CC-MAN-001", worksiteId: "ws-norte" },
    { id: "cc-3", name: "Operaciones Sur",         code: "CC-OPS-001", worksiteId: "ws-sur"   },
    { id: "cc-4", name: "Logística Metropolitana", code: "CC-LOG-001", worksiteId: "ws-metro" },
  ]
  await db.insert(schema.costCenters).values(ccData).onConflictDoNothing()

  /* ── Worksite users (faena scoping) ─────────────────────────────────── */
  const wuData = [
    { userId: "u-admin",    worksiteId: "ws-norte", isPrimary: true  },
    { userId: "u-admin",    worksiteId: "ws-sur",   isPrimary: false },
    { userId: "u-admin",    worksiteId: "ws-metro", isPrimary: false },
    { userId: "u-sol1",     worksiteId: "ws-norte", isPrimary: true  },
    { userId: "u-sol2",     worksiteId: "ws-sur",   isPrimary: true  },
    { userId: "u-jefe1",    worksiteId: "ws-norte", isPrimary: true  },
    { userId: "u-jefe2",    worksiteId: "ws-sur",   isPrimary: true  },
    { userId: "u-prev1",    worksiteId: "ws-norte", isPrimary: true  },
    { userId: "u-prev1",    worksiteId: "ws-sur",   isPrimary: false },
    { userId: "u-compras1", worksiteId: "ws-norte", isPrimary: true  },
    { userId: "u-rec1",     worksiteId: "ws-metro", isPrimary: true  },
    { userId: "u-fin1",     worksiteId: "ws-metro", isPrimary: true  },
    { userId: "u-ger1",     worksiteId: "ws-metro", isPrimary: true  },
  ]
  await db.insert(schema.worksiteUsers).values(wuData).onConflictDoNothing()

  /* ── Suppliers ──────────────────────────────────────────────────────── */
  const supplierData: schema.suppliers["$inferInsert"][] = [
    { id: "sup-1", name: "Industrial Cáceres Ltda.",     rut: "76.483.921-3", contactName: "Hernán Cáceres",    email: "ventas@caceres.cl",     phone: "+56 2 2847 3912", paymentTerms: "30 días" },
    { id: "sup-2", name: "Proveedora Nacional EPP SpA",  rut: "77.182.334-7", contactName: "Roxana Tapia",      email: "rtapia@pnepp.cl",        phone: "+56 9 7834 1029", paymentTerms: "Contado" },
    { id: "sup-3", name: "Ferretería Sur Macrocentro",   rut: "78.341.198-2", contactName: "Carlos Mardones",   email: "cmardones@ferrsur.cl",   phone: "+56 41 247 8834", paymentTerms: "15 días" },
    { id: "sup-4", name: "Equipos y Herramientas Andina", rut: "76.921.445-8", contactName: "Andrea Soto",      email: "asoto@equiposandina.cl", phone: "+56 9 6123 7741", paymentTerms: "30 días" },
  ]
  await db.insert(schema.suppliers).values(supplierData).onConflictDoNothing()

  /* ── Product categories ─────────────────────────────────────────────── */
  const catData: schema.productCategories["$inferInsert"][] = [
    { id: "cat-epp",     name: "EPP",                slug: "epp",         isEpp: true,  requiresPrevencion: true,  sortOrder: 1 },
    { id: "cat-ind",     name: "Indumentaria",       slug: "indumentaria", isEpp: true, requiresPrevencion: false, sortOrder: 2 },
    { id: "cat-herr",    name: "Herramientas",       slug: "herramientas", isEpp: false, requiresPrevencion: false, sortOrder: 3 },
    { id: "cat-ins",     name: "Insumos",            slug: "insumos",      isEpp: false, requiresPrevencion: false, sortOrder: 4 },
    { id: "cat-mat",     name: "Materiales",         slug: "materiales",   isEpp: false, requiresPrevencion: false, sortOrder: 5 },
    { id: "cat-equip",   name: "Equipos",            slug: "equipos",      isEpp: false, requiresPrevencion: false, sortOrder: 6 },
    { id: "cat-cons",    name: "Consumibles",        slug: "consumibles",  isEpp: false, requiresPrevencion: false, sortOrder: 7 },
  ]
  await db.insert(schema.productCategories).values(catData).onConflictDoNothing()

  /* ── Products ───────────────────────────────────────────────────────── */
  const productData: schema.products["$inferInsert"][] = [
    // EPP
    { id: "prod-1",  sku: "EPP-001", name: "Casco de seguridad clase A",     categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "unidad",  referencePrice: 8347  },
    { id: "prod-2",  sku: "EPP-002", name: "Guantes anticorte nivel 5",      categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "par",     referencePrice: 4218  },
    { id: "prod-3",  sku: "EPP-003", name: "Zapatos de seguridad punta acero",categoryId: "cat-epp", isEpp: true, requiresPrevencion: true,  unitOfMeasure: "par",     referencePrice: 37450 },
    { id: "prod-4",  sku: "EPP-004", name: "Lentes de seguridad policarbonato",categoryId: "cat-epp",isEpp: true, requiresPrevencion: true,  unitOfMeasure: "unidad",  referencePrice: 2915  },
    { id: "prod-5",  sku: "EPP-005", name: "Chaleco reflectante clase 2",    categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "unidad",  referencePrice: 7830  },
    { id: "prod-6",  sku: "EPP-006", name: "Arnés de seguridad 5 puntos",    categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "unidad",  referencePrice: 52000 },
    { id: "prod-7",  sku: "EPP-007", name: "Protector auditivo tipo copa",   categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "unidad",  referencePrice: 9120  },
    { id: "prod-8",  sku: "EPP-008", name: "Mascarilla respiratoria N95",    categoryId: "cat-epp",  isEpp: true, requiresPrevencion: true,  unitOfMeasure: "caja/20", referencePrice: 18500 },
    // Indumentaria
    { id: "prod-9",  sku: "IND-001", name: "Overol ignífugo manga larga",    categoryId: "cat-ind",  isEpp: true, requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 42700 },
    { id: "prod-10", sku: "IND-002", name: "Polera térmica UV50+ manga larga",categoryId: "cat-ind", isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 11350 },
    { id: "prod-11", sku: "IND-003", name: "Pantalón cargo denim reforzado", categoryId: "cat-ind",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 19800 },
    // Herramientas
    { id: "prod-12", sku: "HER-001", name: "Llave combinada 13mm",          categoryId: "cat-herr", isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 3750  },
    { id: "prod-13", sku: "HER-002", name: "Alicate de corte lateral 8\"",  categoryId: "cat-herr", isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 6940  },
    { id: "prod-14", sku: "HER-003", name: "Taladro percutor 850W",         categoryId: "cat-herr", isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 89000 },
    // Insumos
    { id: "prod-15", sku: "INS-001", name: "Bloqueador solar FPS50 1L",     categoryId: "cat-ins",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "litro",   referencePrice: 8700  },
    { id: "prod-16", sku: "INS-002", name: "Gel antibacterial 500ml",       categoryId: "cat-ins",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 2140  },
    { id: "prod-17", sku: "INS-003", name: "Cinta de embalaje 48mm x 90m",  categoryId: "cat-ins",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "rollo",   referencePrice: 1380  },
    // Materiales
    { id: "prod-18", sku: "MAT-001", name: "Alambre galvanizado N°16 kg",   categoryId: "cat-mat",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "kg",      referencePrice: 890   },
    { id: "prod-19", sku: "MAT-002", name: "Tornillo cabeza hexagonal M10", categoryId: "cat-mat",  isEpp: false,requiresPrevencion: false, unitOfMeasure: "caja/100",referencePrice: 4250  },
    // Consumibles
    { id: "prod-20", sku: "CON-001", name: "Disco de corte metal 115mm",    categoryId: "cat-cons", isEpp: false,requiresPrevencion: false, unitOfMeasure: "unidad",  referencePrice: 1870  },
  ]
  await db.insert(schema.products).values(productData).onConflictDoNothing()

  /* ── Product attributes (talla for EPP/indumentaria) ─────────────────── */
  const attrData: schema.productAttributes["$inferInsert"][] = [
    // Talla for EPP shoes, overalls, clothing
    { id: "attr-talla-zapato",   productId: "prod-3",  categoryId: null, name: "Talla",  type: "select", isRequired: true,  options: JSON.stringify(["35","36","37","38","39","40","41","42","43","44","45","46"]), sortOrder: 1 },
    { id: "attr-talla-overol",   productId: "prod-9",  categoryId: null, name: "Talla",  type: "select", isRequired: true,  options: JSON.stringify(["XS","S","M","L","XL","XXL","XXXL"]),                          sortOrder: 1 },
    { id: "attr-talla-polera",   productId: "prod-10", categoryId: null, name: "Talla",  type: "select", isRequired: true,  options: JSON.stringify(["XS","S","M","L","XL","XXL"]),                                  sortOrder: 1 },
    { id: "attr-talla-pantalon", productId: "prod-11", categoryId: null, name: "Talla",  type: "select", isRequired: true,  options: JSON.stringify(["28","30","32","34","36","38","40","42"]),                       sortOrder: 1 },
    { id: "attr-talla-casco",    productId: "prod-1",  categoryId: null, name: "Talla",  type: "select", isRequired: false, options: JSON.stringify(["S/M","L/XL","Ajustable"]),                                    sortOrder: 1 },
    { id: "attr-color-casco",    productId: "prod-1",  categoryId: null, name: "Color",  type: "select", isRequired: true,  options: JSON.stringify(["Blanco","Amarillo","Naranjo","Azul","Rojo","Verde"]),          sortOrder: 2 },
    // Worker attribution for EPP
    { id: "attr-worker-epp",     productId: null,      categoryId: "cat-epp", name: "Trabajador",  type: "text", isRequired: false, options: null, sortOrder: 10 },
    { id: "attr-worker-ind",     productId: null,      categoryId: "cat-ind", name: "Trabajador",  type: "text", isRequired: false, options: null, sortOrder: 10 },
  ]
  await db.insert(schema.productAttributes).values(attrData).onConflictDoNothing()

  /* ── Product ↔ Supplier ─────────────────────────────────────────────── */
  const psData: schema.productSuppliers["$inferInsert"][] = [
    { id: "ps-1",  productId: "prod-1",  supplierId: "sup-2", unitPrice: 7890,  isPreferred: true  },
    { id: "ps-2",  productId: "prod-2",  supplierId: "sup-2", unitPrice: 3990,  isPreferred: true  },
    { id: "ps-3",  productId: "prod-3",  supplierId: "sup-2", unitPrice: 35200, isPreferred: true  },
    { id: "ps-4",  productId: "prod-4",  supplierId: "sup-2", unitPrice: 2750,  isPreferred: true  },
    { id: "ps-5",  productId: "prod-5",  supplierId: "sup-2", unitPrice: 7430,  isPreferred: true  },
    { id: "ps-6",  productId: "prod-12", supplierId: "sup-1", unitPrice: 3540,  isPreferred: true  },
    { id: "ps-7",  productId: "prod-13", supplierId: "sup-1", unitPrice: 6580,  isPreferred: true  },
    { id: "ps-8",  productId: "prod-14", supplierId: "sup-4", unitPrice: 84000, isPreferred: true  },
    { id: "ps-9",  productId: "prod-15", supplierId: "sup-1", unitPrice: 8200,  isPreferred: true  },
    { id: "ps-10", productId: "prod-20", supplierId: "sup-3", unitPrice: 1750,  isPreferred: true  },
  ]
  await db.insert(schema.productSuppliers).values(psData).onConflictDoNothing()

  /* ── Warehouse ──────────────────────────────────────────────────────── */
  const warehouseData: schema.warehouses["$inferInsert"][] = [
    { id: "wh-central", name: "Bodega Central Quilicura", code: "BCQ-001", type: "central",   worksiteId: "ws-metro" },
    { id: "wh-norte",   name: "Bodega Faena Norte",       code: "BFN-001", type: "worksite",  worksiteId: "ws-norte" },
  ]
  await db.insert(schema.warehouses).values(warehouseData).onConflictDoNothing()

  /* ── Workers ────────────────────────────────────────────────────────── */
  const workerData: schema.workers["$inferInsert"][] = [
    { id: "wrk-1", rut: "12.847.391-2", firstName: "Luis",     lastName: "Carrasco",  position: "Operador maquinaria", worksiteId: "ws-norte" },
    { id: "wrk-2", rut: "14.293.718-5", firstName: "Miguel",   lastName: "Torres",    position: "Capataz de terreno",  worksiteId: "ws-norte" },
    { id: "wrk-3", rut: "16.482.039-K", firstName: "Pamela",   lastName: "González",  position: "Electricista",        worksiteId: "ws-sur"   },
    { id: "wrk-4", rut: "13.741.829-7", firstName: "Roberto",  lastName: "Maturana",  position: "Soldador",            worksiteId: "ws-sur"   },
    { id: "wrk-5", rut: "17.384.021-3", firstName: "Valentina",lastName: "Pizarro",   position: "Técnico en prevención", worksiteId: "ws-metro" },
  ]
  await db.insert(schema.workers).values(workerData).onConflictDoNothing()

  /* ── Sample purchase requests (Phase 3+ test data) ─────────────────────── */
  const reqData: schema.purchaseRequests["$inferInsert"][] = [
    {
      id: "req-1", code: "SOL-2026-0001",
      worksiteId: "ws-norte", requesterId: "u-sol1", costCenterId: "cc-1",
      urgency: "high", status: "submitted",
      submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      notes: "Kit inicio temporada invierno para equipo de perforación",
    },
    {
      id: "req-2", code: "SOL-2026-0002",
      worksiteId: "ws-sur", requesterId: "u-sol2", costCenterId: "cc-3",
      urgency: "normal", status: "draft",
      notes: "Reposición mensual consumibles",
    },
  ]
  await db.insert(schema.purchaseRequests).values(reqData).onConflictDoNothing()

  const itemData: schema.purchaseRequestItems["$inferInsert"][] = [
    // req-1: submitted items (status requested)
    { id: "ri-1", requestId: "req-1", productId: "prod-1", quantity: 10, unitOfMeasure: "unidad", status: "requested", urgency: "high",   sortOrder: 1, notes: "Para equipo de perforación norte" },
    { id: "ri-2", requestId: "req-1", productId: "prod-3", quantity: 10, unitOfMeasure: "par",    status: "requested", urgency: "high",   sortOrder: 2, notes: "Reponer tallas 40-43" },
    { id: "ri-3", requestId: "req-1", productId: "prod-9", quantity:  5, unitOfMeasure: "unidad", status: "requested", urgency: "normal", sortOrder: 3 },
    { id: "ri-4", requestId: "req-1", productId: null, productNameFree: "Guantes de nitrilo talla M (100 uds)", quantity: 3, unitOfMeasure: "caja",  status: "requested", urgency: "normal", sortOrder: 4, notes: "Sin código EPP, uso general" },
    // req-2: draft items
    { id: "ri-5", requestId: "req-2", productId: "prod-20", quantity: 50, unitOfMeasure: "unidad", status: "draft", sortOrder: 1 },
    { id: "ri-6", requestId: "req-2", productId: "prod-17", quantity: 20, unitOfMeasure: "rollo",  status: "draft", sortOrder: 2 },
  ]
  await db.insert(schema.purchaseRequestItems).values(itemData).onConflictDoNothing()

  // Attributes for sized items in req-1
  const riAttrData: schema.requestItemAttributes["$inferInsert"][] = [
    { id: "ria-1", requestItemId: "ri-2", attributeId: "attr-talla-zapato", attributeName: "Talla", value: "40,41,42,43 (2-3 pares c/u)" },
    { id: "ria-2", requestItemId: "ri-3", attributeId: "attr-talla-overol",  attributeName: "Talla", value: "L (x3), XL (x2)" },
  ]
  await db.insert(schema.requestItemAttributes).values(riAttrData).onConflictDoNothing()

  console.log("✅ Seed completado.")
  console.log("")
  console.log("  Usuarios de prueba (contraseña: chome2026):")
  users.forEach((u) => console.log(`    ${u.email}`))
  console.log("")
  console.log("  Faenas:  Atacama Norte / Biobío Sur / Planta Metropolitana")
  console.log("  Productos: 20 items (EPP, Indumentaria, Herramientas, Insumos, Materiales, Consumibles)")
  console.log("  Proveedores: 4")
  console.log("  Bodegas: 2 (Central Quilicura + Faena Norte)")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => sqlite.close())
