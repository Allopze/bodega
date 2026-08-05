# Auditoría del estado actual — Facturación y Cobranza

**Fecha:** 2026-08-04
**Alcance:** todo lo que la plataforma ya tiene relacionado con facturas, DTE, dinero,
proveedores, clientes, faenas y conciliación. Base para implementar el módulo
**Facturación y Cobranza** (cuentas por cobrar).
**Método:** lectura del repositorio (esquema, servicios, rutas, pruebas, migraciones,
documentación previa) + verificación en vivo del contrato público de Chipax.
No se transcriben credenciales ni datos personales.

---

## 1. Resumen ejecutivo

La plataforma es un sistema de **abastecimiento, bodega, flota y prevención**. Todo su
lado financiero mira hacia **afuera-adentro**: solicitudes → aprobaciones → órdenes de
compra → recepción → facturas **de proveedor**. Existe una integración real y funcional
con el portal **FacturaEnLínea** que trae **exclusivamente documentos recibidos**
(compras) y los concilia contra órdenes de compra y cargas de combustible.

El módulo pedido es el **lado inverso**: lo que Chome factura y cobra a sus clientes.
De ese lado **no existe nada** en el repositorio:

| Entidad requerida | Existe hoy |
|---|---|
| Cliente | ❌ (existe `suppliers` = proveedores, que no es lo mismo) |
| Contrato | ❌ |
| Servicio ejecutado / orden de trabajo | ❌ |
| Estado de pago | ❌ |
| Factura de venta | ❌ (`dte_documents` guarda solo recibidas) |
| Pago / cobro | ❌ |
| Movimiento bancario | ❌ |
| Gestión de cobranza | ❌ |
| Faena (`worksites`) | ✅ |
| Centro de costo (`cost_centers`) | ✅ |
| Adjuntos, auditoría, notificaciones | ✅ |

Conclusiones operativas:

1. **FacturaEnLínea se mantiene y se amplía, no se reemplaza.** Está bien construida,
   probada y es hoy la única fuente de documentos tributarios. Se encapsula detrás de
   una interfaz de proveedor y se le agrega la capacidad de **ventas** (`rlib=ven`),
   que el portal ya expone y el código ya sabe consultar pero nunca sincroniza.
2. **El dominio comercial hay que crearlo.** Clientes, contratos, y el vínculo
   factura → cliente/contrato/faena/período son tablas nuevas. No hay nada que migrar
   ni ampliar, así que no hay riesgo de romper relaciones existentes.
3. **Chipax no es implementable con evidencia hoy** (ver §11). Su contrato OpenAPI está
   detrás de autenticación. Se deja la arquitectura, el flag y las pruebas listas.
4. **`dte_documents` no se toca en su forma actual.** Se amplía (columnas nuevas
   nulables) y se le agrega una tabla de referencias externas. Ninguna columna se borra.

---

## 2. Arquitectura detectada

| Aspecto | Realidad del repositorio |
|---|---|
| Lenguaje | TypeScript estricto |
| Framework | **Next.js 16** (App Router), React 19.2 |
| Frontend | Server Components por defecto; Client Components solo para interacción. Tailwind v4, Radix UI, primitivas propias en `components/ui/` (55 archivos: `page-header`, `filter-toolbar`, `responsive-data-list`, `summary-bar`, `kpi-card`, `empty-state`, `server-pagination`, `confirm-dialog`, `export-button`…) |
| Backend | Server Actions (`app/(app)/**/actions*.ts`) para mutaciones + Route Handlers (`app/api/**`) para cron, descargas y export |
| Base de datos | PostgreSQL, driver `postgres` (postgres.js) |
| ORM | **Drizzle ORM** 0.45, esquema en `db/schema/*.ts`, un único `db/schema/index.ts` como punto de exportación |
| Migraciones | `drizzle-kit`, SQL versionado en `db/migrations/` (**136 archivos**, `0000`–`0135`) + `meta/_journal.json`. Verificador propio: `npm run db:verify-migrations` |
| Autenticación | **next-auth v5 beta** (`lib/auth/auth.ts`), credenciales + bcrypt |
| Autorización | RBAC propio: `roles`, `permissions`, `role_permissions`, `user_permissions`, `worksite_users`. `lib/auth/rbac.ts` arma un snapshot cacheado 5 s. Helpers: `can`, `canAny`, `requirePermission`, `guardPermission` (`lib/auth/can.ts`), scope por faena en `lib/auth/scope.ts` |
| Organización modular | **`modules/<id>/manifest.ts`** declara `permissions`, `permissionMeta`, `nav`, `defaultGrants`, `seed`. `modules/registry.ts` los une; el tipo `Permission` y la navegación **se derivan del registry** (`modules/permissions.ts`). Agregar un módulo = 1 import + 1 línea |
| Servicios externos | FacturaEnLínea (portal DTE), Copec TCT/TAE, Resend (correo), Sentry, rclone/Google Drive (respaldos) |
| Procesos programados | Route handlers bajo `app/api/cron/*` protegidos por `CRON_SECRET` con `timingSafeEqual` (`lib/security/cron-auth.ts`). Scheduler externo |
| Colas de trabajo | **No hay.** Trabajo largo corre en el request del cron o de la acción manual |
| Caché | En memoria con TTL (RBAC). No hay Redis |
| Archivos | Disco, `STORAGE_PATH` (`lib/storage/config.ts`), rutas relativas guardadas en BD |
| Notificaciones | Tabla `notifications` + correo por Resend con plantillas en BD |
| Auditoría | `audit_log` (`recordAudit`), `status_history`, `attachments`, y `operational_activity_events` para actividad global |
| Variables de entorno | `.env.example` documentado campo por campo; `scripts/check-env-files.ts` evita filtrar secretos. Configuración runtime alternativa en `system_settings` (KV) |
| Pruebas | **Vitest** (`vitest.config.ts`, más variantes pglite / non-pglite) para unidad e integración con Postgres real por suite; **Playwright** en `e2e/` (incluye `@axe-core/playwright`) |
| Patrones | Servicios puros en `lib/services/*`; acciones delgadas que validan con **Zod** y delegan; `numeric` con `mode: "number"` para dinero (nunca `float`); IDs `text` con `nanoid` (`lib/id.ts`); `check` constraints en BD para todo enum; índices explícitos; comentarios en español |
| Convenciones | Tablas y columnas `snake_case`, propiedades TS `camelCase`; permisos `modulo:accion`; toasts vía `@/lib/toast` (no `sonner` directo) |

Nada de esto necesita una arquitectura paralela. El módulo nuevo se implementa como
un manifest más (`modules/billing/manifest.ts`), esquema en `db/schema/billing.ts`,
servicios en `lib/services/billing/*`, pantallas en `app/(app)/facturacion/*`.

---

## 3. Flujo actual de FacturaEnLínea

### 3.1 Qué es realmente

`clientes.dtefacturaenlinea.cl` es un portal PHP legacy del emisor de DTE. **No hay
API.** La integración es **scraping HTTP autenticado por query string**:

```
Origen: portal PHP (ISO-8859-1)
  → autenticación: rut_usr + rut_emp + clave EN CADA REQUEST (sin cookie, sin token)
  → extracción: POST/GET a PNC_PanelCorreo.php (compras) o paneldte.php (ventas)
  → parseo de HTML con regex/estructura de tabla (parser.ts, bandeja-entrada.ts)
  → validación: tipos/números/fechas normalizados en el parser
  → almacenamiento: dte_documents (+ dte_sync_runs)
  → deduplicación: unique (tipo_dte, folio, rut_emisor, cod_emp) + raw_hash SHA-256
  → conciliación: reconciliation.ts → purchase_order_invoices y fuel_loads
  → consumo: /compras/dte, /compras/[id], /admin/dte, dashboard, 3 reportes
  → actualización: cron mensual + botón manual, con re-sync por force
```

### 3.2 Dirección de los documentos: **solo compras (recibidas)**

Evidencia: `sync.ts` llama `fetchBandejaEntrada` (Bandeja de Entrada del Panel Correo),
documentado en el propio archivo y en `EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md`.
El libro `paneldte.php?rlib=com` está **vacío** (0 documentos en 4 meses medidos) porque
los DTE recibidos quedan `PENDIENTE` en la bandeja y nadie los procesa hacia el libro.

**El lado de ventas ya es alcanzable con el código existente pero no se usa:**
`query.ts::queryByPeriodo({ rlib: "ven" })` + `parser.ts::parseDteTable` funcionan y
tienen fixture y pruebas (`__tests__/fixtures/paneldte-compras-periodo.html.ts`,
`parser.test.ts`). El portal reporta 43–48 documentos de venta por mes para la empresa
`CodEmp=433`. **Ese es el insumo del módulo nuevo.**

### 3.3 Detalle técnico verificado

| Punto | Estado |
|---|---|
| Método | Scraping HTTP (`undici` con `Agent` TLS 1.2 + `SECLEVEL=0`; el portal rechaza el handshake moderno). El certificado sí valida — no se usa `rejectUnauthorized: false` |
| Campos obtenidos (compras) | fecha recepción, estado plataforma, fecha doc, tipo, folio, RUT emisor, razón social, monto total, referencias (tipo/folio/fecha), `nreguist`, URL PDF, URL XML |
| Campos **no** obtenidos | neto, IVA y exento por documento (la bandeja solo trae total; quedan `null` hasta descargar el XML bajo demanda), ítems, fecha de vencimiento, condición de pago |
| Identificador estable | `(tipo_dte, folio, rut_emisor, cod_emp)` — correcto: el folio no es único global |
| Período histórico | Completo, filtrable por `mes` + `anio`. El filtro `peri=YYYY-MM` es derivado y se ignora |
| Frecuencia | Cron `GET /api/cron/dte-portal-sync` (mes actual) + botón manual en `/admin/dte`. `DTE_SYNC_ENABLED` la apaga |
| Paginación | **No la hay**: el portal devuelve todo el período en una respuesta (verificado con 681 documentos). `parseDteTable` avisa por consola si el total declarado no cuadra con las filas parseadas — es el detector de que la suposición dejó de valer |
| Manejo de errores | `DtePortalError` con taxonomía (`AUTH_FAILED`, `PARSE_FAILED`, `RATE_LIMITED`, `TIMEOUT`…). Timeout 120 s (la bandeja tarda ~80 s en meses grandes) |
| Reintentos | Un fallo por documento no aborta la corrida (`failures` → `partial`); no hay reintento de la consulta completa |
| Concurrencia | Corridas `running` de más de 1 h se marcan `failed` (`markStaleRunsAsFailed`). **No hay lock**: dos disparos simultáneos del mismo período pueden solaparse; el upsert por clave única evita duplicados, pero las estadísticas de la corrida quedan repartidas |
| Reanudable | Parcialmente: se re-corre el período completo (idempotente), no hay cursor intra-período |
| Credenciales | `system_settings` (panel `/admin/dte`) con precedencia sobre `DTE_PORTAL_*` del entorno. **`dte.clave` queda en texto plano en la BD** — decisión consciente y documentada en `settings.ts`. La auditoría solo guarda `••••••••` |
| Fugas en logs | `sync.ts` y el cron sanitizan mensajes que contengan `clave`/`rut_usr` |
| Pruebas | 7 suites (`client`, `parser`, `sync`, `settings`, `config`, `bandeja-entrada`, `reconciliation`) con fixtures HTML reales |
| Estado real | **Activa y funcionando.** Verificada contra el portal real: 681/681 documentos sincronizados |

### 3.4 Fuente de verdad hoy

FacturaEnLínea es la fuente de verdad de **la existencia y el estado tributario de los
documentos recibidos**. La plataforma es la fuente de verdad de OCs, recepciones y
combustible. El vínculo entre ambos (`dte_documents.purchase_order_invoice_id`,
`fuel_load_id`) lo calcula `reconciliation.ts` **automáticamente y sin confirmación
humana** — ver §7.

---

## 4. Archivos y componentes involucrados

**Integración (`lib/services/dte-portal/`, 2.566 líneas + 7 suites):**
`client.ts` (HTTP + TLS legacy + delay), `config.ts` (env + BD), `settings.ts`
(credenciales en `system_settings` + auditoría), `query.ts` (4 formularios de
`paneldte.php`), `parser.ts` (HTML → filas), `bandeja-entrada.ts` (Panel Correo),
`sync.ts` (corridas, upsert, dedupe), `reconciliation.ts` (match a OC/combustible +
salud), `download.ts` (XML/PDF bajo demanda), `labels.ts`, `types.ts`, `index.ts`.

**Esquema:** `db/schema/dte.ts` — `dte_sync_runs`, `dte_documents`.

**Rutas y pantallas:**
`app/api/cron/dte-portal-sync/route.ts`, `app/api/dte-portal/sync/route.ts`,
`app/(app)/admin/dte/` (page + `credentials-form.tsx` + `actions.ts` + `settings-actions.ts`),
`app/(app)/compras/dte/page.tsx`, `app/(app)/compras/[id]/dte-received-card.tsx`,
`app/(app)/compras/actions/dte-download-xml.ts`, `app/(app)/dashboard/dashboard-domain-sections.tsx`.

**Reportes:** `lib/reports/export-module/dte-libro-compras.ts`,
`dte-facturas-sin-oc.ts`, `dte-conciliacion.ts`.

**Otro código de facturas (compras, independiente del portal):**
`lib/services/purchasing-module/dte-parser.ts` (parser de XML DTE),
`invoice-extractor.ts` + `invoice-ocr.ts` (OCR de facturas subidas a mano),
`app/(app)/compras/[id]/invoices-section.tsx`.

**Documentación previa:** `explicacion_integral_dte_facturaenlinea.md` (contrato del
portal), `EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md` (inventario de
capacidades reales), `AUDITORIA_OCR_FACTURAS_2026-07-30.md`,
`MEJORA_FLUJO_FACTURA_OC_2026-07-31.md`.

---

## 5. Modelo de datos actual

**Lo que existe y sirve directamente:**

- `worksites` (faenas) — `id`, `name`, `code`, `region`, `is_active`. Es el eje de
  scope de permisos de toda la plataforma.
- `cost_centers` — `code`, `name`, `worksite_id`.
- `suppliers` — proveedores, con `rut` único y `payment_terms`. **No sirve como
  clientes**: semántica opuesta y ya está referenciada por OCs y cotizaciones.
- `users` + RBAC + `worksite_users` (scope por faena).
- `purchase_orders` → `purchase_order_items` → `purchase_order_invoices` →
  `purchase_order_invoice_items`; `receipts`/`receipt_items`.
- `dte_documents` / `dte_sync_runs`.
- `attachments`, `audit_log`, `status_history`, `notifications`,
  `operational_activity_events`, `work_item_assignments` (responsable por etapa de
  cualquier entidad, vía `source_type` + `source_id` + `action_key` — **reutilizable**
  para asignar responsable de cobranza sin tabla nueva).
- `system_settings` (KV), `code_sequences` (folios internos).

**Lo que falta por completo:** clientes, contratos, servicios ejecutados, estados de
pago, facturas de venta, pagos, movimientos bancarios, gestiones de cobranza,
referencias externas multi-proveedor.

**¿Puede una factura relacionarse con…?** Hoy `dte_documents` solo puede apuntar a
`purchase_order_invoices` y `fuel_loads`, **una sola** de cada, y **una sola** fuente
externa (los campos `cod_emp`/`periodo`/`raw_hash` asumen un único proveedor). Cliente,
contrato, faena, período de servicio, pagos y adjuntos: **no**.

---

## 6. Funciones que ya existen y se reutilizan

| Necesidad del módulo | Se reutiliza |
|---|---|
| Cliente HTTP al portal, TLS legacy, delay, taxonomía de errores | `dte-portal/client.ts` |
| Consulta del libro de **ventas** | `query.ts::queryByPeriodo({ rlib: "ven" })` + `parser.ts` (ya probados) |
| Credenciales gestionables sin tocar el servidor | `settings.ts` + `config.ts` |
| Registro de corridas con estadísticas | patrón `dte_sync_runs` |
| Descarga de XML/PDF bajo demanda | `download.ts` |
| Normalización de RUT | `lib/rut.ts::cleanRut` |
| Auditoría | `lib/audit.ts::recordAudit` |
| Permisos, scope por faena, guardas de acción | `lib/auth/*` |
| Responsable por etapa | `work_item_assignments` |
| Adjuntos | `attachments` |
| Exportaciones con protección anti-fórmula | `lib/reports/export-module/*` |
| UI: cabecera, filtros persistentes, tabla responsive, KPIs, vacíos, paginación server, confirmaciones | `components/ui/*` |
| IVA configurable | `TAX_RATE` (0,19) |

---

## 7. Problemas y riesgos detectados

| # | Hallazgo | Severidad | Evidencia |
|---|---|---|---|
| P-1 | **Conciliación automática sin confirmación humana.** `matchToPurchaseOrderInvoices` escribe el vínculo directamente; no hay estado `sugerido` ni quién lo confirmó, ni forma de deshacerlo desde la UI | Alta | `reconciliation.ts` |
| P-2 | **`dte.clave` en texto plano** en `system_settings` | Alta (aceptada) | `settings.ts`, comentario explícito |
| P-3 | **Sin lock de corrida.** Dos syncs concurrentes del mismo período se solapan; el guard `force` solo mira corridas `success` | Media | `sync.ts` |
| P-4 | **Neto/IVA/exento nulos** en casi todos los documentos: la bandeja solo trae total. Cualquier reporte de IVA sobre `dte_documents` es incompleto | Media | `sync.ts` (`montoNeto: null`) |
| P-5 | **Una sola referencia externa por documento.** No hay forma de que el mismo documento provenga de FEL y de Chipax sin duplicar la fila | Media | `db/schema/dte.ts` |
| P-6 | **`raw_hash` incluye `estadoPlataforma`**, así que un cambio de estado cuenta como "updated" — correcto, pero el hash no sirve como identidad del documento, solo como detector de cambios. No confundirlo con hash de deduplicación entre fuentes | Baja | `computeDocumentHash` |
| P-7 | **Fechas como `text`** (`fecha_emision`) en vez de `date`. Consistente con el resto del repo, pero obliga a comparar strings; sirve porque el formato es `YYYY-MM-DD` | Baja | `db/schema/dte.ts` |
| P-8 | **Sin fecha de vencimiento** en ningún documento: el portal no la entrega en la lista. Sin ella no hay "vencida" real; hay que derivarla de condiciones de pago del contrato | Media | §3.3 |
| P-9 | **Scraping frágil por naturaleza**: cualquier cambio de HTML rompe el parser. Mitigado con fixtures, pero sin alerta proactiva de cambio de estructura | Media | `parser.ts` |
| P-10 | `estado_sii` / `estado_intercambio` quedan `null` en compras (esos íconos son del panel de ventas). En ventas **sí** vendrán poblados | Baja | `sync.ts` |
| P-11 | El error de conciliación se traga con `console.error` y no afecta el estado de la corrida: un fallo sistemático de conciliación es invisible en `/admin/dte` | Baja | `sync.ts` |

---

## 8. Funciones que deben corregirse

Se corrigen **dentro** del alcance de este módulo, sin cambiar el comportamiento
actual de compras:

1. **P-1** — la conciliación pasa a tener estado (`suggested` / `confirmed` /
   `rejected`) y autor para el lado de **ventas y pagos**. El match automático de
   compras se conserva tal cual para no romper `/compras/dte`, pero se documenta.
2. **P-3** — lock de corrida por `(provider, direction, período)` en la sincronización
   nueva; se aplica también a la de compras al pasar por la interfaz de proveedor.
3. **P-5** — tabla de referencias externas (`billing_external_refs`) que permite N
   proveedores por documento interno.
4. **P-8** — `due_date` derivable de condiciones de pago del contrato, editable a mano
   y con trazabilidad de origen.
5. **P-11** — el resultado de la conciliación queda registrado en la corrida.

---

## 9. Dependencias con otros módulos

- **Compras/`purchasing`**: consume `dte_documents`. Cualquier cambio de esquema debe
  ser aditivo y nulable. `/compras/dte`, `/compras/[id]` y 3 reportes dependen de las
  columnas actuales.
- **Combustibles**: `dte_documents.fuel_load_id`.
- **Admin**: `/admin/dte` gestiona credenciales y dispara syncs.
- **Dashboard**: `dashboard-domain-sections.tsx` lee salud DTE; el módulo nuevo agrega
  su propia sección sin tocar las existentes.
- **Reportes**: `lib/reports/export-module/dispatcher.ts` es el punto de registro para
  los reportes nuevos.
- **Faenas**: eje de scope. Toda consulta del módulo debe respetar `visibleWorksiteIds`.
- **`modules/registry.ts`**: registrar `billingModule` habilita permisos y navegación.

---

## 10. Comparación FacturaEnLínea vs Chipax

| Capacidad | FacturaEnLínea (verificado) | Chipax (verificable hoy) |
|---|---|---|
| Facturas emitidas | ✅ `paneldte.php?rlib=ven`, 43–48/mes, con estado SII e intercambio | ❓ no inspeccionable |
| Facturas recibidas | ✅ Panel Correo, 681/mes | ❓ |
| XML / PDF | ✅ por documento | ❓ |
| Neto / IVA / exento | ⚠️ solo al descargar el XML | ❓ |
| Ítems de la factura | ⚠️ solo desde el XML | ❓ |
| Pagos | ❌ no existe en el portal | ❓ |
| Movimientos bancarios / cartolas | ❌ | ❓ |
| Clientes | ⚠️ solo el nombre/RUT que aparece en cada documento | ❓ |
| Emisión de DTE | ✅ existe en el portal — **fuera de alcance, no se automatiza** | ❓ |
| Autenticación | credenciales en el query string, sin token | login que devuelve token (según la ayuda pública) |
| Contrato | HTML sin contrato; documentado a mano en el repo | OpenAPI **detrás de autenticación** |

**Estado de la verificación de Chipax (2026-08-04):**

```
GET https://api.chipax.com/v2/swagger-docs/        → 200, Swagger UI estático
GET .../swagger-docs/swagger-initializer.js        → url: "https://petstore.swagger.io/v2/swagger.json"  ← plantilla sin configurar
GET https://api.chipax.com/v2/swagger.json         → 401 {"message":"Unauthorized"}
GET https://api.chipax.com/v2/api-docs             → 401
GET https://api.chipax.com/v2/openapi.json         → 401
POST https://api.chipax.com/v2/login  (cuerpo {})  → 400 {"error":"Parámetros inválidos."}
```

Es decir: el endpoint de login **existe** y valida parámetros, pero el documento
OpenAPI no es público. **Sin credenciales no hay contrato, y sin contrato no se
escribe código de integración.** Es un tope duro, no una preferencia: inventar rutas o
campos en una integración financiera es exactamente el fallo que hay que evitar.

---

## 11. Estrategia recomendada para FacturaEnLínea

**Encapsular y ampliar. No corregir agresivamente, no reemplazar.**

1. Se define una interfaz de proveedor por **capacidades** (`lib/services/billing/providers/`).
   `FacturaEnLineaProvider` declara: puede listar emitidas, puede listar recibidas,
   puede traer XML; **no** puede listar pagos, **no** puede listar movimientos
   bancarios, **no** crea documentos.
2. El código actual de compras **sigue llamando a `syncDteDocuments` como hoy**. El
   proveedor lo envuelve; no se reescribe el scraping.
3. Se agrega la sincronización de **ventas** reutilizando `queryByPeriodo` + `parser`
   ya probados, escribiendo en el modelo normalizado nuevo.
4. `ChipaxProvider` existe con sus capacidades en `false` y un `healthCheck` que
   reporta "contrato no inspeccionado"; queda tras feature flag apagado.
5. `ManualProvider` cubre la carga a mano y el XML importado, que es lo que permite
   operar el módulo sin ninguna integración disponible.

---

## 12. Matriz de responsabilidades

| Dato | Fuente primaria | Secundaria | Regla de conflicto |
|---|---|---|---|
| Existencia de la factura emitida (tipo, folio, RUT, fecha, total) | FacturaEnLínea | Chipax / manual | El proveedor gana sobre la inferencia; **nunca** sobre un valor confirmado a mano |
| Neto / IVA / exento | XML del documento | FEL (lista) | El XML gana |
| Estado tributario (SII, intercambio, anulado) | FacturaEnLínea | — | Solo externo; no editable |
| Cliente, contrato, faena, período de servicio | **Chome** | — | Solo interno |
| Fecha de vencimiento | Contrato (condición de pago) | Manual | Manual gana; queda registrado quién y cuándo |
| Pagos y movimientos bancarios | Chipax (cuando exista) / manual | — | Toda asociación nace `suggested`; solo una persona autorizada la confirma |
| Estado de cobranza y gestiones | **Chome** | — | Solo interno |
| Emisión tributaria | Portal FEL, a mano | — | **La plataforma no emite DTE** |

Regla transversal: **una inferencia automática nunca sobrescribe un dato confirmado por
una persona**, y todo campo guarda de dónde vino.

---

## 13. Alcance de la implementación

**Dentro:** clientes y contratos; modelo normalizado de facturas con dirección
venta/compra; referencias externas multi-proveedor; ítems; pagos con estados;
gestiones de cobranza; propuestas de facturación; pendientes de facturar;
deduplicación clasificada; capa de proveedores; sincronización de ventas desde FEL;
centro de sincronización; dashboard y reportes con datos reales; permisos en backend;
auditoría; pruebas unitarias, de integración y e2e; documentación.

**Fuera:** emisión de DTE; aceptación/rechazo de documentos recibidos (Ley 19.983);
contabilidad; libro de compras/ventas tributario oficial; escrituras en Chipax;
cualquier operación externa irreversible.

---

## 14. Plan de migración

1. **Aditivo puro.** Todas las tablas del módulo son nuevas. `dte_documents` recibe
   solo columnas nulables; ninguna se borra ni se renombra.
2. **Sin backfill destructivo.** Los documentos de compra existentes se pueden
   proyectar al modelo nuevo con un script idempotente que **no borra** nada y se
   puede correr N veces.
3. **Funcionamiento paralelo.** `/compras/dte` sigue leyendo `dte_documents`; el módulo
   nuevo lee su propio modelo. Nada se apaga hasta que haya comparación.
4. **Modo simulación obligatorio** en cualquier importación histórica, con fecha
   inicial explícita y por lotes.
5. **Rollback:** las migraciones nuevas se revierten borrando tablas nuevas y columnas
   nulables agregadas; ninguna pérdida de datos preexistentes. Se documenta en
   `docs/facturacion/ROLLBACK.md`.

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El HTML del portal cambia y rompe el parser de ventas | Fixture propio + prueba; el parser avisa si el total declarado no cuadra; corrida queda `failed` visible en el centro de sincronización |
| Chipax nunca se activa | El módulo funciona completo con FEL + carga manual. Chipax es aditivo y está tras flag |
| Duplicados al sincronizar dos veces | Clave única por dirección+tipo+folio+RUT emisor+RUT receptor + referencias externas por proveedor. Prueba de idempotencia obligatoria |
| Conciliación de pagos equivocada | Toda sugerencia nace `suggested` con evidencia y confianza; solo confirmación humana con permiso propio la vuelve real; reversible y auditada |
| Suma de monedas distintas | La moneda es parte de toda agregación; los totales se calculan por moneda y la UI nunca suma monedas distintas |
| Fuga de datos entre faenas | Toda consulta filtra por `visibleWorksiteIds`; validación en backend, no solo ocultar botones |
| Credenciales | Nunca al frontend, nunca a logs, nunca al repositorio. Diagnóstico sin secretos |
| Otro proceso edita el checkout en paralelo | Cambios acotados a archivos nuevos siempre que sea posible; `dte_documents` se toca solo de forma aditiva |

---

## Apéndice — verificación de esta auditoría

- Esquema leído: `db/schema/index.ts` y los 40 archivos que exporta.
- Integración leída íntegra: `lib/services/dte-portal/*` (12 archivos, 2.566 líneas).
- Búsquedas: `cliente|customer|contrato|contract` en `db/schema` → sin entidades
  comerciales; `chipax` en todo el repo (excluyendo `node_modules`) → **cero
  ocurrencias**; `dte` en `app`+`lib` → 56 archivos.
- Migraciones: 136 archivos `0000`–`0135`.
- Chipax: probado en vivo, resultados en §10.
