# Benchmark de capacidades solapadas: Bodega, Odoo 19 y ERPNext 17-dev

**Estado:** benchmark técnico; no es un plan de integración, sustitución ni adopción de runtime externo

**Fecha nominal del encargo:** 2026-09-07

**Revisión de alcance:** 2026-09-08

**Base de evidencia:** fuentes primarias del árbol local; sin Internet y sin ejecutar Odoo ni ERPNext

## 1. Alcance corregido

Este informe responde una pregunta acotada: **para capacidades que Bodega ya posee, cómo resuelven la misma necesidad Bodega, Odoo y ERPNext; quién exhibe la mejor propiedad relevante y qué patrón concreto conviene replicar dentro de Bodega**.

No evalúa reemplazar Bodega, integrarla con un ERP ni ampliar su frontera funcional para igualar catálogos. Odoo y ERPNext son proyectos de referencia. Toda réplica propuesta es una implementación nativa sobre la arquitectura vigente de Bodega —Next.js, TypeScript, Drizzle y PostgreSQL— y debe mantener `lib/` + `app/` como fuente de verdad (`modules/README.md:1-20`).

La comparación conserva como restricciones de producto:

- el alcance operacional por **faena**, cuya intersección de permisos devuelve cero filas ante una faena no autorizada (`lib/auth/scope.ts:54-94`);
- la identidad completa de producto/variante —talla, color, medida, modelo u otros atributos—, no una talla aislada (`db/schema/products.ts:91-122`);
- la profundidad propia en SST, prevención, PDTP y DTE, incluida la segregación y evidencia de CAPA (`lib/services/prevention-capa.ts:193-235`);
- exportaciones sólo en Excel y con saneamiento de fórmulas/nombres de hoja (`lib/reports/export-module/excel-builder.ts:15-25`, `lib/reports/export-module/excel-builder.ts:83-135`);
- adjuntos, actividad, alertas y reportes sujetos a los mismos permisos y scopes de su entidad fuente.

Las funciones no solapadas —GL completo, POS, MRP, e-commerce, CRM amplio, multiempresa y otras— se excluyen de la matriz y del backlog. Se nombran sólo en “Fuera de alcance” para impedir que reaparezcan como deuda ficticia.

## 2. Método de evaluación

### 2.1 Unidad de comparación

Cada fila exige tres evidencias positivas: una capacidad ya operativa en Bodega y el mecanismo equivalente visible en los snapshots locales de Odoo/ERPNext. Una dependencia declarada no basta para certificar un motor ausente.

El ganador se decide por la propiedad que más importa **dentro del contexto de Bodega**, en este orden:

1. integridad, autorización y confidencialidad;
2. fidelidad al proceso real y a la faena;
3. auditabilidad y recuperabilidad;
4. reducción demostrable de duplicación o costo operacional;
5. configurabilidad y amplitud.

Por eso “más genérico” no significa automáticamente “mejor”. `Empate dirigido` significa que hay propiedades superiores distintas y se replica sólo la pieza útil. `No replicar` es un veredicto válido cuando Bodega ya resuelve mejor la propiedad relevante.

### 2.2 Prioridad

- **P0:** riesgo o costo recurrente alto; patrón acotado con piloto claro.
- **P1:** mejora transversal valiosa que requiere un contrato compartido.
- **P2:** mejora útil condicionada por volumen, demanda o evidencia adicional.
- **No replicar:** conservar el patrón Bodega o reevaluar sólo ante un requisito nuevo.

### 2.3 Límites de los snapshots

- Odoo declara versión 19.0 final (`odoo-19.0/odoo/release.py:9-17`). El árbol local incluye los addons base relevantes para esta intersección —entre ellos `product`, `uom`, `stock`, `purchase`, `account` y `base_import`—; la comparación se limita a los archivos citados.
- ERPNext declara 17.0.0-dev y depende de Frappe 17 (`erpnext-develop/erpnext/__init__.py:1-7`, `erpnext-develop/pyproject.toml:44-45`), pero Frappe no está local. Se certifican los contratos y usos visibles en ERPNext, no el runtime genérico ausente.
- No hubo UAT, benchmark de rendimiento ni comparación de SaaS, precios, comunidad o marketplace.
- Las conclusiones de ausencia se limitan a `app/`, `lib/`, `db/`, `modules/`, `scripts/`, CI y documentación relevante de primera parte.

## 3. Matriz ejecutiva exhaustiva

| Capacidad ya presente en Bodega | Bodega | Odoo 19 local | ERPNext 17-dev local | Ganador / veredicto | Propiedad superior | Réplica concreta dentro de Bodega | Prioridad |
|---|---|---|---|---|---|---|---|
| Modularidad | Registro tipado deriva navegación, permisos y seed (`modules/manifest-types.ts:38-46`, `modules/registry.ts:35-74`) | Un addon declara dependencias, seguridad, datos, vistas, cron, assets y hooks; admite herencia sin copiar modelo/vista (`odoo-19.0/addons/sale/__manifest__.py:3-108`, `odoo-19.0/addons/project_purchase/models/purchase_order.py:3-9`) | Hooks centrales cubren eventos, permisos, scheduler, clases y métodos (`erpnext-develop/erpnext/hooks.py:329-353`, `erpnext-develop/erpnext/hooks.py:385-552`) | **Odoo** | Contrato de módulo cohesivo y extensible | Profundizar el manifiesto sólo con consumidores reales: eventos, jobs, reportes y rutas públicas; no revivir el monolito congelado | P1 |
| Metadata y formularios | Drizzle, Zod y formularios TS explícitos; atributos reutilizables por categoría (`db/schema/products.ts:186-205`) | Modelos/campos/vistas y herencia registrados; campos incluyen required, readonly, default, grupos y traducción (`odoo-19.0/odoo/addons/base/models/ir_model.py:215-277`, `odoo-19.0/odoo/orm/fields.py:92-155`) | DocTypes declaran layout, tipos, dependencias, permisos, búsqueda y tracking (`erpnext-develop/erpnext/stock/doctype/item/item.json:1-180`, `erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1297-1357`) | **Odoo**, por cobertura transversal | Una definición alimenta varias superficies sin borrar extensiones | Piloto de `EntityPresentationSpec` tipado para columnas, labels, filtros y exportación de una entidad; reglas de negocio siguen en servicios | P1 |
| Workflow | Estados e invariantes fuertes por servicio; CAPA exige evidencia, eficacia y segregación (`lib/services/prevention-capa.ts:193-235`) | Automatizaciones por modelo con triggers de estado, tiempo, mensaje, webhook y CRUD (`odoo-19.0/addons/base_automation/models/base_automation.py:124-180`) | Workflows como datos con roles, condiciones y transiciones; documentos agregan side effects de dominio (`erpnext-develop/erpnext/selling/doctype/sales_order/test_sales_order.py:3793-3831`, `erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.py:433-535`) | **Bodega** en flujo regulatorio; ERPNext en declaratividad | Invariantes específicas sobre configuración genérica | Extraer un kernel de transición: estado actual, permiso, motivo, auditoría y evento; conservar callbacks tipados por dominio | P1 |
| Autorización y scope | RBAC, grants directos y faena; el filtro solicitado se intersecta con el techo del usuario (`db/schema/users.ts:55-103`, `lib/auth/scope.ts:75-94`) | ACL por operación, record rules globales/de grupo y restricciones por campo (`odoo-19.0/odoo/addons/base/models/ir_model.py:2080-2176`, `odoo-19.0/odoo/addons/base/models/ir_rule.py:113-173`) | Permisos por rol/operación/permlevel y hooks de query/entidad (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1308-1347`, `erpnext-develop/erpnext/hooks.py:329-353`) | **Bodega** para el dominio actual | Scope por faena explícito, fail-closed y probado | Registrar políticas de scope por servicio/módulo para detectar omisiones; no sustituir `worksiteScopeSql` por reglas JSON | P0 |
| Auditoría e historial | `audit_log` guarda actor, before/after, motivo e IP; `status_history` separa transiciones (`db/schema/audit.ts:5-36`) | Campos de acceso automáticos y tracking/chatter por modelo (`odoo-19.0/odoo/orm/models.py:4384-4402`, `odoo-19.0/addons/mail/models/mail_tracking_value.py:35-150`) | `track_changes` declarativo en documentos (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1350-1357`) | **Bodega** | Evidencia explícita orientada a decisiones operacionales | Añadir auditoría como capability opt-in del contrato de entidad y verificación CI de mutaciones sensibles sin `recordAudit`/`recordStatusChange` | P0 |
| Actividad y notificaciones | Eventos transversales seguros por faena/actor/entidad, filtrados por permiso; notificaciones navegables y deduplicadas (`db/schema/operations.ts:27-49`, `lib/services/operational-activity.ts:50-75`, `lib/services/operational-activity.ts:162-211`, `db/schema/audit.ts:84-105`) | `mail.thread` une seguidores, mensajes, actividades, adjuntos y errores de entrega al registro (`odoo-19.0/addons/mail/models/mail_thread.py:104-168`) | Integra Communication, ToDo/calendario y eventos, aunque la base es Frappe (`erpnext-develop/erpnext/hooks.py:34-59`, `erpnext-develop/erpnext/hooks.py:411-418`) | **Odoo**, sobre una base Bodega ya sólida | Contexto colaborativo completo por registro | **Profundizar** `operationalActivityEvents` con responsables, tareas, seguidores opcionales, comentarios y adjuntos gobernados; no crear otra bandeja | P1 |
| Jobs y tareas masivas | `withCronLock` evita solapamientos con lock de sesión; algunas corridas persisten cursor, contadores y errores (`lib/services/cron-lock.ts:30-65`, `db/schema/billing.ts:483-535`) | Scheduler guarda prioridad, próxima/última ejecución y fallos; ejecuta en transacción y reporta progreso (`odoo-19.0/odoo/addons/base/models/ir_cron.py:91-127`, `odoo-19.0/odoo/addons/base/models/ir_cron.py:399-451`) | Catálogo horario/diario/semanal/mensual y bulk jobs con savepoint/reintento/resultado (`erpnext-develop/erpnext/hooks.py:485-552`, `erpnext-develop/erpnext/utilities/bulk_transaction.py:53-125`) | **Odoo** | Ledger operacional general y visible | `job_runs` nativo con lease, attempts, cursor, progreso, dedupe, correlation, resultado redactado y retención; conservar handlers actuales | P0 |
| Integraciones | DTE, Chipax, combustibles, Onway, Cloudreve, Drive y correo; Billing Sync Run ya registra ejecución (`db/schema/billing.ts:483-559`) | Addons aíslan dependencias, seguridad, assets y uninstall hook (`odoo-19.0/addons/cloud_storage_google/__manifest__.py:3-25`) | Integraciones usan savepoints/rollback y enqueue; EDI resuelve listas/versiones canónicas (`erpnext-develop/erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:98-183`, `erpnext-develop/erpnext/edi/doctype/code_list/code_list.py:66-169`) | **Empate dirigido** | Bodega: adaptación local; Odoo: lifecycle uniforme | Contrato común de capabilities, prueba de conexión, cursor, idempotencia, health, disable y retención; sin plugins ni runtime externos | P1 |
| Stock, kardex y proyección | Stock por producto-faena no negativo, movimientos before/after, folios de ajuste y conteo físico (`db/schema/stock.ts:9-78`, `db/schema/stock.ts:99-125`) | Distingue on-hand, free, incoming, outgoing y forecast; expone reglas de mínimo (`odoo-19.0/addons/stock/models/product.py:50-126`) | Ledger bloquea item-bodega en orden estable, revalora y actualiza Bin; reorden usa cantidad proyectada (`erpnext-develop/erpnext/stock/stock_ledger.py:103-199`, `erpnext-develop/erpnext/stock/reorder_item.py:36-74`) | **ERPNext**, por integridad; Odoo en semántica de disponibilidad | Proyección y control de concurrencia/repost | Añadir `on_hand/reserved/incoming/available` por producto-faena y monitor de integridad; bloquear claves en orden estable | P0 |
| Productos, variantes, UOM y barcodes | SKU único, familia EPP, UOM textual, atributos completos por variante y plantillas de categoría (`db/schema/products.ts:16-50`, `db/schema/products.ts:91-122`, `db/schema/products.ts:167-205`) | Variante enlaza valores de atributo, barcode único por producto/empaque y parser GS1 (`odoo-19.0/addons/product/models/product_product.py:45-60`, `odoo-19.0/addons/product/models/product_product.py:246-290`, `odoo-19.0/addons/barcodes_gs1_nomenclature/models/barcode_nomenclature.py:10-140`) | Múltiples barcodes por UOM/tipo, validación y protección de cambios tras movimientos (`erpnext-develop/erpnext/stock/doctype/item_barcode/item_barcode.json:1-36`, `erpnext-develop/erpnext/stock/doctype/item/item.py:535-569`, `erpnext-develop/erpnext/stock/doctype/item/item.py:983-1028`) | **ERPNext**, por amplitud e integridad histórica; Bodega conserva mejor su identidad operacional | Barcode/UOM gobernados sin mutar historia | Conservar variante concreta en todo payload/documento. Agregar aliases GTIN/barcode por variante y conversiones UOM sólo ante un caso real de recepción | P2 |
| Compras, recepción y factura | OC por faena/proveedor con montos, entrega directa/oficina, cantidades recibidas y vínculo de factura por línea (`db/schema/purchasing.ts:20-74`, `db/schema/purchasing.ts:78-125`, `db/schema/purchasing.ts:232-260`) | La línea une UOM, impuestos, factura, recibido, facturado y cantidad a facturar; convierte UOM y netea notas de crédito (`odoo-19.0/addons/purchase/models/purchase_order_line.py:40-89`, `odoo-19.0/addons/purchase/models/purchase_order_line.py:165-207`) | OC preserva cotización origen, UOM stock, recibido, devuelto y facturado por línea (`erpnext-develop/erpnext/buying/doctype/purchase_order_item/purchase_order_item.json:500-540`, `erpnext-develop/erpnext/buying/doctype/purchase_order_item/purchase_order_item.json:599-648`) | **Odoo**, por madurez end-to-end; Bodega gana en faena, doble recepción y DTE chileno | Continuidad completa por línea y UOM | Cerrar allocation cantidad/monto N:N y desglose de impuesto/flete usando IDs de línea; mantener faena, variante y DTE | P0 |
| Conciliación y tolerancias | Estado persistido, fingerprint, excepción humana con motivo/evidencia y tolerancia CLP acotada (`db/schema/purchasing.ts:43-74`, `db/schema/purchasing.ts:263-275`, `lib/services/system-settings.ts:24-50`) | Purchase Bill Matching compara líneas abiertas y cantidades facturadas; Account incorpora conciliación bancaria/contable (`odoo-19.0/addons/purchase/models/purchase_bill_line_match.py:22-119`, `odoo-19.0/addons/account/models/account_reconcile_model.py:48-121`) | Documentos acumulan recibido/facturado y el GL tiene reconciliación, con parte genérica en Frappe | **Bodega** para excepción/tolerancia local; Odoo en matching reutilizable | Tolerancia explícita y decisión auditable | Separar tolerancias por magnitud/proveedor, explicar diferencias e invalidar review al cambiar fingerprint | P0 |
| Documentos, adjuntos e indexación | SST tiene carpetas/faena, confidencialidad, versión, checksum, distribución/acuse y auditoría, además de adjuntos genéricos (`db/schema/prevention/library.ts:65-120`, `db/schema/prevention/library.ts:200-245`, `db/schema/audit.ts:38-49`) | Indexa ODT/PDF/XLSX/DOCX y desacopla storage de adjuntos (`odoo-19.0/addons/attachment_indexation/__manifest__.py:4-18`, `odoo-19.0/addons/cloud_storage_google/__manifest__.py:3-25`) | Adjuntos visibles en flujos; gestor genérico no certificable sin Frappe | **Bodega** para control documental; Odoo para full-text | Gobierno/versionado antes que amplitud de índice | Piloto full-text sólo con documentos no clínicos de compras; ACL, borrado y retención se derivan de la entidad, nunca del índice | P2 |
| Búsqueda, filtros y vistas | TopBar distingue el filtro de página en memoria de las rutas con búsqueda server-side; DataTable conecta search, columnas/sort en URL, densidad y scroll estable; las vistas personales guardan la URL en `localStorage` (`components/layout/top-bar.tsx:23-70`, `components/ui/data-table.tsx:65-107`, `components/ui/data-table.tsx:176-220`, `lib/hooks/use-saved-views.ts:7-18`, `lib/hooks/use-saved-views.ts:87-121`) | Vistas heredables list/form/kanban/graph/pivot y export/listas guardadas (`odoo-19.0/addons/sale/views/sale_order_views.xml:45-95`, `odoo-19.0/addons/web/controllers/export.py:364-515`) | DocTypes marcan search/index/list; catálogo de global search (`erpnext-develop/erpnext/projects/doctype/project/project.json:71-124`, `erpnext-develop/erpnext/hooks.py:691-733`) | **Empate dirigido** | Bodega: UX y vistas personales controladas; Odoo: definición reutilizable y más tipos de vista | Registro tipado de campos buscables/filtrables/columnas con `sensitivity` y resolver de scope; mantener URL/localStorage y usar DB sólo si se exige compartir entre dispositivos/personas | P1 |
| Reportes y XLSX | Dispatcher cerrado, múltiples hojas, límites y neutralización de fórmulas (`lib/reports/export-module/dispatcher.ts:1-49`, `lib/reports/export-module/excel-builder.ts:4-25`, `lib/reports/export-module/excel-builder.ts:83-135`) | Export genérico selecciona campos/relaciones, audita y genera XLSX; también CSV, que se descarta (`odoo-19.0/addons/web/controllers/export.py:167-195`, `odoo-19.0/addons/web/controllers/export.py:364-515`, `odoo-19.0/addons/web/controllers/export.py:686-723`) | Script Reports declaran permisos y filtros; XLSX financiero específico (`erpnext-develop/erpnext/accounts/report/general_ledger/general_ledger.json:1-42`, `erpnext-develop/erpnext/accounts/report/profit_and_loss_statement/profit_and_loss_statement.py:9-12`) | **Bodega** | Exportación segura, acotada y conforme a XLSX-only | Convertir el switch en catálogo tipado de permiso, scope, filtros, columnas, hojas, maxRows y auditoría; no ofrecer consulta arbitraria ni CSV | P1 |
| PDF e impresión | Catálogo de seis documentos; sólo OC habilita Chromium y pdfcn/Takumi, con fallback seguro (`lib/pdf/engines.ts:1-14`, `lib/pdf/engines.ts:25-96`, `lib/pdf/engines.ts:98-134`) | QWeb centraliza acciones, paper format y renderers PDF/HTML/text (`odoo-19.0/odoo/addons/base/models/ir_actions_report.py:157-186`, `odoo-19.0/odoo/addons/base/models/ir_actions_report.py:1019-1119`) | Print Format genérico pertenece a Frappe ausente; no certificable | **Bodega** | Capability real por documento y degradación controlada | Profundizar `PDF_DOCUMENT_SPECS` con permiso, plantilla/versión, evidencia y prueba dorada; no copiar QWeb | P1 |
| Observabilidad y health checks | Logger JSON redacta PII/secretos, Sentry/correlation y corridas con métricas (`lib/logger.ts:1-24`, `lib/logger.ts:74-165`, `db/schema/billing.ts:483-535`) | Logs JSON, sinks configurables y profiler SQL/stack (`odoo-19.0/odoo/logging.py:14-75`, `odoo-19.0/odoo/tools/profiler.py:508-580`) | Ledger Health detecta desbalance y discrepancia; tests corrompen ambas fuentes para probarlo (`erpnext-develop/erpnext/accounts/utils.py:2663-2701`, `erpnext-develop/erpnext/accounts/doctype/ledger_health/test_ledger_health.py:37-107`) | **Empate dirigido** | Bodega protege datos; ERPNext verifica invariantes | Monitores read-only para stock before/after, OC-recepción-factura, DTE-pago y PDTP; persistir casos accionables con correlation ID | P0 |
| Migraciones y upgrades | Drizzle con journal monotónico, migraciones inmutables y verificación posterior (`db/migrations/README.md:27-55`, `db/migrations/README.md:83-100`) | Migraciones pre/post/end por versión y codemods con dry-run (`odoo-19.0/odoo/modules/migration.py:58-87`, `odoo-19.0/odoo/cli/upgrade_code.py:132-173`) | `patches.txt` ordena transformaciones pre/post model sync (`erpnext-develop/erpnext/patches.txt:1-47`, `erpnext-develop/erpnext/patches.txt:127-136`) | **Odoo** | Upgrade de producto además de esquema | Ledger reanudable `pre-schema → migrate → post-schema → reconcile → verify`; Drizzle sigue siendo la única fuente de esquema | P1 |
| Testing y query budgets | CI separa suites y DB reales; un dataset mediano impone SLO de 1 s y bloquea CI (`scripts/measure-operational-queries.ts:18-43`, `scripts/measure-operational-queries.ts:219-225`, `scripts/measure-operational-queries.ts:449-456`, `.github/workflows/ci.yml:353-357`) | Harness unifica TransactionCase, HttpCase, tours y assertions de cantidad de queries (`odoo-19.0/odoo/tests/common.py:531-610`, `odoo-19.0/odoo/tests/common.py:2450-2583`, `odoo-19.0/odoo/tests/common.py:2712-2729`) | CI shardea MariaDB y PostgreSQL; linters incluyen Semgrep/test correctness (`erpnext-develop/.github/workflows/server-tests-postgres.yml:141-200`, `erpnext-develop/.github/workflows/linters.yml:1-48`) | **Empate dirigido** | Bodega: presupuesto temporal real; Odoo: conteo determinista N+1 | Añadir conteo de queries sólo a 3 lecturas críticas sobre el SLO existente y pruebas de corrupción para health; no perseguir conteos de tests | P1 |
| Autenticación | Credentials con bcrypt, dummy hash anti-enumeración, rate limit persistente y revocación RBAC fresca (`lib/auth/auth.ts:20-35`, `lib/auth/auth.ts:98-149`) | OAuth2 y LDAP como addons (`odoo-19.0/addons/auth_oauth/__manifest__.py:4-23`, `odoo-19.0/addons/auth_ldap/__manifest__.py:3-20`) | El auth genérico pertenece a Frappe ausente; no certificable | **Bodega** para baseline actual; Odoo si aparece SSO | Defensa local verificable frente a federación opcional | No tocar auth por paridad. Si existe requisito corporativo, agregar un proveedor OIDC a NextAuth conservando rate limit, revocación y RBAC | No replicar / P2 condicional |
| i18n y localización textual | UI principalmente en español; no se encontró catálogo/extractor transversal | PO con pluralización, referencias y `es_CL`; loader de traducciones (`odoo-19.0/addons/sale/i18n/es.po:1-31`, `odoo-19.0/odoo/tools/translate.py:1560-1650`) | Extractores TS/TSX y catálogos PO con referencias (`erpnext-develop/babel_extractors.csv:1-5`, `erpnext-develop/erpnext/locale/es.po:1-40`) | **Odoo** | Extracción, pluralización y trazabilidad del origen | Catálogo tipado incremental para shell, estados y documentos; locale por defecto `es-CL`; no traducir masivamente lógica regulatoria | P2 |
| Onboarding y ayuda contextual | Guías y runbooks operacionales, pero las experiencias se construyen por pantalla | Tours declarados como assets/pruebas (`odoo-19.0/addons/sale/__manifest__.py:91-105`) | Onboarding guía Supplier → Item → PO → Invoice y tours de formulario (`erpnext-develop/erpnext/buying/module_onboarding/buying_onboarding/buying_onboarding.json:1-40`, `erpnext-develop/erpnext/buying/form_tour/supplier_form_tour/supplier_form_tour.json:1-41`) | **ERPNext** | Pasos por rol y progreso contextual | Piloto declarativo en un flujo infrecuente de alto error; selectores accesibles y Playwright determinista | P2 |
| Configuración y administración | Parámetros tipados, con rangos y auditoría before/after; PDF expone sólo capabilities reales (`lib/services/system-settings.ts:24-68`, `lib/services/system-settings.ts:142-200`, `lib/services/system-settings.ts:255-302`, `lib/pdf/engines.ts:38-96`) | Configuración amplia desde metadata/modelos | Singletons/DocTypes de settings por módulo, dependientes de Frappe | **Bodega** | Configurabilidad limitada por invariantes y capabilities | Mantener allowlist tipada con dueño, rango, permiso y efecto; añadir versionado/preview sólo para ajustes de alto riesgo | No replicar |
| Secuencias y folios | Secuencias PostgreSQL nativas reservan atómicamente, documentan gaps aceptables y permiten listar/ajustar el próximo valor (`lib/code-sequences.ts:13-51`, `lib/code-sequences.ts:54-121`) | `ir.sequence` soporta prefijo/sufijo, incremento, no-gap y rangos de fecha (`odoo-19.0/odoo/addons/base/models/ir_sequence.py:88-152`) | `naming_series` y variables de año fiscal/mes/día/semana (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1-14`, `erpnext-develop/erpnext/hooks.py:463-468`) | **Bodega** para sus folios internos; Odoo sólo si se exige formato administrable/no-gap | Atomicidad simple con trade-off explícito | Conservar el servicio actual; no volver configurable el formato ni prometer no-gap salvo requisito legal separado | No replicar |
| Importaciones | Seguridad XLSX; EPP persiste hash, original/normalizado, reglas y revisión humana (`lib/services/xlsx-security.ts:1-77`, `db/schema/epp-imports.ts:7-77`, `lib/services/epp-import.ts:57-108`, `lib/services/epp-import.ts:122-188`) | Preview y mapeo sugerido por metadata; dry-run hace rollback y conserva errores/mappings (`odoo-19.0/addons/base_import/models/base_import.py:130-175`, `odoo-19.0/addons/base_import/models/base_import.py:1461-1519`) | Importadores se apoyan en metadata de DocType/Frappe; runtime no certificable | **Empate dirigido** | Bodega: seguridad/revisión de dominio; Odoo: preview/mapping reusable | Registry común XLSX con schema/version, dry-run, preview, dedupe hash, resumen por fila y auditoría; normalizadores siguen por dominio | P0 |
| Privacidad SST y datos sensibles | Casos reservados, membresía por propósito, auditoría sensible y derechos del titular (`db/schema/prevention/privacy.ts:46-122`, `db/schema/prevention/privacy.ts:124-177`) | Privacy lookup ayuda a localizar registros; no prueba una política SST equivalente (`odoo-19.0/addons/privacy_lookup/__manifest__.py:4-17`) | Privacidad genérica no certificable sin Frappe | **Bodega** | Modelo explícito para confidencialidad regulada | No replicar un índice/chatter global sobre salud o casos reservados; cualquier capability nueva hereda estas políticas | No replicar |

## 4. Hallazgos detallados

### 4.1 Bodega no es la opción “menos madura” por ser menos genérica

Bodega gana o empata allí donde el costo de un error es operacional o regulatorio: scope por faena, variante concreta, workflows de SST/PDTP, conciliación con decisión humana, Excel seguro, privacidad y logging con redacción. Su `operationalActivityEvents` tampoco es una ausencia: ya normaliza hechos por módulo, entidad, actor y faena, limita el payload a metadata no sensible y filtra la lectura por permiso y scope (`db/schema/operations.ts:27-49`, `lib/services/operational-activity.ts:50-75`, `lib/services/operational-activity.ts:162-211`).

La conclusión correcta no es “construir el chatter de Odoo”. Es completar esa base con responsabilidades y colaboración donde el proceso lo necesita, sin duplicar el audit log ni mezclar casos reservados. Lo mismo vale para configuración: el catálogo acotado de Bodega evita activar una capacidad que el código no implementa, como muestra la matriz de motores PDF (`lib/pdf/engines.ts:38-96`).

### 4.2 Los mejores patrones de plataforma son incrementales

Odoo gana en cohesión modular, metadata, scheduler y upgrades porque una definición común alimenta varias superficies. Bodega ya resuelve correctamente sus secuencias internas con primitivas nativas de PostgreSQL; ERPNext aporta ejemplos especialmente claros de workflow documentario, cantidad proyectada, continuidad cuantitativa de compras, health checks y onboarding.

Replicar esos patrones no requiere un metaframework. El primer corte debe generar sólo artefactos repetidos —labels, columnas, filtros, permisos de lectura, exportación— desde contratos TS. Estado, autorización, transacciones y efectos laterales siguen en servicios profundos. El manifiesto actual ya es un punto de unión útil (`modules/registry.ts:1-8`); agrandarlo sin consumidores ejecutables produciría metadata huérfana.

### 4.3 Inventario y compras son el mejor piloto de integridad

Bodega ya tiene stock no negativo, movimientos con saldo anterior/posterior, documentos manuales y conteos físicos (`db/schema/stock.ts:9-50`, `db/schema/stock.ts:54-125`). También conserva OC, modalidad de entrega, cantidades de recepción, DTE/factura por línea y excepciones de conciliación (`db/schema/purchasing.ts:20-125`, `db/schema/purchasing.ts:232-275`).

Odoo modela explícitamente on-hand, reservado/libre, incoming, outgoing y forecast (`odoo-19.0/addons/stock/models/product.py:50-126`). ERPNext aporta el bloqueo determinista item-bodega y el reorden por proyectado (`erpnext-develop/erpnext/stock/stock_ledger.py:103-199`, `erpnext-develop/erpnext/stock/reorder_item.py:36-74`). La réplica útil es pequeña: reservar/esperar/disponible por producto-faena, locks ordenados y un monitor que detecte incoherencias. No se replica valoración contable ni se reemplaza el kardex Bodega.

En compras, Odoo y ERPNext preservan recibido/facturado por línea; Odoo además convierte UOM y netea notas de crédito (`odoo-19.0/addons/purchase/models/purchase_order_line.py:165-207`). La prioridad en Bodega no es agregar RFQ por paridad: es terminar la continuidad de las líneas que ya existen. La estructura actual enlaza factura con una línea de OC (`db/schema/purchasing.ts:232-260`); el siguiente paso es soportar allocation cantidad/monto explícito cuando una línea del comprobante corresponde a varias líneas de OC, y separar impuesto/flete sin perder DTE, faena ni variante.

### 4.4 Jobs, health e integraciones necesitan un plano operacional común

Los cron de Bodega están protegidos correctamente contra solapamiento: el advisory lock vive en una conexión reservada y el segundo disparo se omite (`lib/services/cron-lock.ts:17-65`). La debilidad comparativa es que prioridad, intentos, lease, progreso y resultado no están normalizados para todos los jobs. Odoo sí modela estos atributos de forma transversal (`odoo-19.0/odoo/addons/base/models/ir_cron.py:91-127`, `odoo-19.0/odoo/addons/base/models/ir_cron.py:399-451`).

El `job_runs` propuesto debe absorber operación, no lógica de dominio. Un handler Chipax, PDTP o TI conserva sus reglas; el ledger aporta dedupe, correlation, cursor, retries y retención. El mismo plano permite health checks como los de ERPNext, cuyas pruebas corrompen datos para demostrar detección (`erpnext-develop/erpnext/accounts/doctype/ledger_health/test_ledger_health.py:37-107`).

Para integraciones, Bodega ya tiene corridas persistidas y eventos legibles (`db/schema/billing.ts:483-559`). Se replica el lifecycle de addon —capabilities, conexión, health, disable— como interfaz interna, no el sistema de plugins, marketplace ni un proceso Python externo.

### 4.5 Actividad, documentos, búsqueda y vistas deben heredar seguridad

Odoo concentra mensajes, followers, tareas, adjuntos y errores de entrega en `mail.thread` (`odoo-19.0/addons/mail/models/mail_thread.py:104-168`) y su indexador cubre formatos Office/PDF (`odoo-19.0/addons/attachment_indexation/__manifest__.py:4-18`). Ambos patrones mejoran descubrimiento, pero sólo son seguros en Bodega si el permiso se evalúa desde la entidad fuente en cada lectura.

La ruta correcta es extender la actividad existente y probar primero indexación de documentos no clínicos de compras. No deben indexarse payloads clínicos, casos reservados ni evidencia SST fuera de sus políticas. El índice es una proyección eliminable; jamás una nueva fuente de autorización.

Para vistas, `DataTable` ya ofrece búsqueda desde TopBar, densidad, columnas/sort persistidos en URL y `scroll: false` (`components/ui/data-table.tsx:65-107`, `components/ui/data-table.tsx:176-220`). `useSavedViews` ya conserva por navegador la URL completa de cada vista y limita el número por scope (`lib/hooks/use-saved-views.ts:7-18`, `lib/hooks/use-saved-views.ts:87-121`). Antes de persistir vistas compartidas en DB conviene centralizar campos disponibles y clasificación de sensibilidad; no hace falta replicar kanban/pivot para cada entidad.

### 4.6 XLSX, PDF e importaciones: profundizar las fortalezas locales

Bodega ya es superior para su regla de exportación: un conjunto cerrado de reportes con max rows, varias hojas, nombres seguros y neutralización de fórmulas (`lib/reports/export-module/dispatcher.ts:18-49`, `lib/reports/export-module/excel-builder.ts:15-25`, `lib/reports/export-module/excel-builder.ts:83-135`). Odoo inspira selección de campos y listas guardadas, pero su exportación CSV y su apertura genérica no son patrones aceptables aquí.

La mejora es un catálogo tipado de reportes, no un query builder: cada entrada declara permiso, scope, filtros, columnas, formatos, hojas, límite y evento de auditoría. En PDF, `PDF_DOCUMENT_SPECS` ya cataloga seis documentos y restringe el doble motor Chromium/pdfcn a OC (`lib/pdf/engines.ts:25-96`); se profundiza con versión de plantilla/evidencia y pruebas por documento, sin adoptar QWeb.

En importaciones, la seguridad XLSX de Bodega merece conservarse. El validador inspecciona firma, expansión, entradas y límites antes del parseo (`lib/services/xlsx-security.ts:1-77`). Odoo aporta preview, mapeo asistido, dry-run con rollback y memoria del mapping (`odoo-19.0/addons/base_import/models/base_import.py:130-175`, `odoo-19.0/addons/base_import/models/base_import.py:1461-1519`). Un registro común Bodega debe añadir esas capacidades y hash de dedupe, pero cada normalizador de dominio mantiene su semántica.

### 4.7 Auth, i18n, onboarding y administración

Auth no exige una réplica inmediata. Bodega ya mitiga enumeración, fuerza rate limits persistentes y refresca revocaciones RBAC (`lib/auth/auth.ts:25-35`, `lib/auth/auth.ts:98-149`). OAuth/LDAP de Odoo son superiores sólo si aparece un requisito de identidad corporativa; entonces se añade OIDC al stack actual, no otro runtime.

i18n y onboarding sí muestran una ventaja transferible, pero P2. Odoo/ERPNext conservan referencias de origen en catálogos (`odoo-19.0/addons/sale/i18n/es.po:1-31`, `erpnext-develop/erpnext/locale/es.po:1-40`) y ERPNext declara recorridos por módulo (`erpnext-develop/erpnext/buying/module_onboarding/buying_onboarding/buying_onboarding.json:1-40`). La adopción debe partir por shell, estados y un flujo infrecuente de alto error; no reescribir de una vez textos legales ni duplicar la documentación operacional.

Administración es una fortaleza Bodega porque expone ajustes con rango, default, permiso y auditoría before/after (`lib/services/system-settings.ts:24-68`, `lib/services/system-settings.ts:142-200`). No se replica la configurabilidad total de Odoo/ERPNext. Cada nuevo ajuste debe demostrar que existe una capability real y que su cambio no puede debilitar seguridad o invariantes.

### 4.8 Upgrades y pruebas

Drizzle protege bien el esquema, pero no ordena por sí solo transformaciones de datos, reconciliaciones y verificaciones de producto. Odoo separa fases de migración y ofrece codemods con dry-run (`odoo-19.0/odoo/modules/migration.py:58-87`, `odoo-19.0/odoo/cli/upgrade_code.py:132-173`); ERPNext mantiene una secuencia explícita pre/post sync (`erpnext-develop/erpnext/patches.txt:1-47`). Un ledger Bodega debe envolver —no reemplazar— la migración Drizzle.

En testing no existe una deuda general frente a los comparados: Bodega combina suites unitarias, PGlite, PostgreSQL real, QA browser y un SLO temporal de consultas que bloquea CI (`.github/workflows/ci.yml:44-131`, `.github/workflows/ci.yml:163-260`, `.github/workflows/ci.yml:353-357`). Sobre esa base se replica de Odoo sólo el conteo determinista de queries para detectar N+1 y de ERPNext las pruebas de corrupción controlada. Deben comenzar con tres lecturas críticas y casos medibles, no con snapshots frágiles de cada query.

## 5. Backlog por módulos piloto y dependencias

### Piloto A — Compras + Recepción + Bodega

**Objetivo:** cerrar integridad cuantitativa en capacidades ya operativas.

1. **P0 — Allocation de conciliación.** Modelar cantidad y monto asignados entre línea DTE/factura y una o más líneas OC; invalidar excepciones por fingerprint al cambiar la evidencia.
2. **P0 — Proyección de stock por producto-faena.** `on_hand`, `reserved`, `incoming`, `available`; semántica explícita por estado terminal/cancelado.
3. **P0 — Health checks.** Detectar stock before/after inconsistente, recepción mayor a OC y factura/NC no conciliada; sólo lectura + casos accionables.

**Dependencias:** `worksiteScopeSql`, identidad completa de variante, `audit_log`, `operationalActivityEvents`, transacciones PostgreSQL, política de tolerancias y pruebas con Postgres real. **No depende** de GL, valoración contable, Odoo ni ERPNext en runtime.

### Piloto B — Plataforma operacional compartida

**Objetivo:** hacer observables jobs e integraciones existentes.

1. **P0 — `job_runs`.** Lease/lock, attempts, progress, cursor, dedupe, correlation, resultado redactado y retención; migrar primero un cron no crítico y una importación masiva.
2. **P1 — Contrato de conectores actuales.** Capabilities, configuración segura, test de conexión, health, cursor, idempotencia y disable lógico; adoptar primero en un conector existente con `Billing Sync Run`. No contempla Odoo ni ERPNext como destino.
3. **P1 — Upgrade ledger.** Pasos reanudables y versionados alrededor de Drizzle: pre, migrate, post, reconcile, verify.
4. **P1 — Query-count budget complementario.** Sobre el SLO de 1 s existente, instrumentar tres servicios con riesgo N+1 y umbrales documentados.

**Dependencias:** logger/Sentry, redacción de secretos, `withCronLock`, retention settings, correlation IDs, migraciones Drizzle y CI serializada.

### Piloto C — Actividad + Documentos + Búsqueda

**Objetivo:** profundizar la actividad transversal existente sin abrir datos.

1. **P1 — Actividad enriquecida.** Responsables/tareas, followers opt-in, comentarios y adjuntos asociados a `operationalActivityEvents` o su entidad; no una tabla de actividad paralela.
2. **P1 — `EntityPresentationSpec`.** Campos de búsqueda, columnas, filtros, label, sensibilidad y permiso para un único módulo.
3. **P2 — Índice documental gobernado.** Un tipo documental no clínico de compras; proyección borrable con ACL de la entidad.
4. **P2 — Vista compartible.** Conservar la base URL + `localStorage`; guardar en DB sólo si hay demanda comprobada multi-dispositivo/equipo.

**Dependencias:** matriz de permisos por entidad, `resolveWorksiteScope`, clasificación de sensibilidad, lifecycle de adjuntos, borrado/retención y pruebas de no filtración entre faenas.

### Piloto D — Reportes + PDF + Importaciones + Admin

**Objetivo:** convertir implementaciones sólidas en contratos reutilizables.

1. **P0 — Registry de importaciones.** Extraer desde el flujo EPP ya staged/auditable el contrato XLSX-only: schema version, dry-run/preview, hash de dedupe, límites, errores por fila y auditoría; los normalizadores permanecen en cada dominio.
2. **P1 — Registry de reportes.** Permiso, scope, filtros, columnas, hojas, maxRows y evento de exportación.
3. **P1 — Contrato PDF ampliado.** Template/version, capability real, permiso y verificación por documento.
4. **P2 — i18n + onboarding.** Catálogo `es-CL` para shell/estados y tour de un flujo infrecuente.

**Dependencias:** `xlsx-security`, builder XLSX seguro, `system_settings`, catálogo PDF actual, auditoría, PageHeader/TopBar y Playwright. No se agrega CSV, QWeb ni constructor SQL arbitrario.

## 6. Cosas a no replicar

1. **No integrar ni reemplazar Bodega con Odoo/ERPNext.** Son referencias de diseño; ninguna propuesta ejecuta Python/Frappe/Odoo ni sincroniza dos fuentes de verdad.
2. **No ampliar el manifiesto por aspiración.** Cada nuevo campo necesita consumidor, contrato y prueba; no se revive `modules/*/{services,actions,schema,validation}`.
3. **No mover autorización, segregación o evidencia regulatoria a JSON/XML editable.** El kernel común no puede saltar invariantes SST/PDTP/CAPA.
4. **No sustituir faena por compañía genérica** ni perder talla/color/medida/modelo en tablas, búsqueda, documentos o actividad.
5. **No crear un chatter o centro de actividad paralelo.** Se profundizan `operationalActivityEvents`, audit log, notificaciones y adjuntos existentes.
6. **No indexar salud, casos reservados ni evidencia sensible** en una búsqueda global. Un índice nunca concede acceso.
7. **No copiar export CSV, spreadsheet/pivot genérico o SQL self-service.** La regla sigue siendo XLSX-only, con datasets gobernados.
8. **No adoptar QWeb, Frappe Forms, workers Python ni colas externas.** Los patrones se implementan en el runtime Bodega actual.
9. **No hacer workflows/webhooks arbitrarios configurables por administradores.** Una automatización no debe convertirse en bypass de permisos o SSRF.
10. **No copiar código sin revisión de licencia.** Odoo declara LGPLv3 y ERPNext GPLv3 (`odoo-19.0/LICENSE:2-16`, `erpnext-develop/license.txt:1-11`); se adoptan ideas e invariantes, no implementaciones literales.
11. **No promover a backlog funcionalidades fuera de intersección.** Que un ERP las tenga no demuestra necesidad de producto en Bodega.

## 7. Fuera de alcance, no backlog

Quedan fuera: libro mayor/plan de cuentas/cierre financiero completo, POS, MRP, e-commerce, CRM amplio, multiempresa, marketplace de addons, portales genéricos cliente/proveedor, nómina y activos fijos contables.

Estas capacidades no reciben prioridad, épica ni recomendación de integración. Sólo podrían volver a evaluarse ante un cambio explícito del alcance de Bodega.

## 8. Límites de evidencia y verificación

1. La evidencia es estática y local. “Ganador” significa mejor propiedad visible en fuente para el contexto definido, no superioridad total de producto.
2. Odoo y ERPNext no fueron levantados; no se verificaron UX, permisos efectivos, rendimiento, upgrades ni errores de runtime.
3. La ausencia de Frappe impide certificar auth, permisos, formularios, attachments, print formats y colas genéricas de ERPNext.
4. El árbol de Odoo estaba siendo materializado durante la inspección original; este informe sólo atribuye capacidades observadas en los archivos citados en la revisión final, no en conteos ni dependencias.
5. No se ejecutaron tests de Bodega porque este cambio sólo reescribe documentación. Sí corresponde validar rutas/líneas citadas, diff y que el informe sea el único archivo modificado por este trabajo.
6. Las prioridades son hipótesis de cartera. Antes de implementar cada piloto se debe medir duplicación, incidentes o costo actual y escribir criterios de aceptación.

## 9. Veredicto

No hay ganador global. Odoo ofrece los mejores patrones de plataforma transversal; ERPNext aporta mecanismos concretos de integridad de stock/compras, health y onboarding; Bodega es superior en varias propiedades que definen su producto: faena, variante completa, workflows regulatorios, conciliación chilena, privacidad SST, XLSX seguro, PDF por capability y observabilidad con redacción.

La cartera correcta no intenta “volver ERP” a Bodega. Profundiza sus capacidades existentes en cuatro pilotos: integridad compras-stock, plano operacional de jobs/integraciones, actividad/documentos/búsqueda gobernada y contratos de reportes/PDF/importaciones. Todo se implementa dentro de Bodega y bajo sus invariantes actuales.
