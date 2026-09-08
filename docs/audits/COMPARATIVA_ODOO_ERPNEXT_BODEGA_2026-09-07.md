# Comparativa local: Odoo 19, ERPNext 17-dev y Bodega

**Estado:** informe técnico final, no plan aprobado de implementación

**Fecha nominal del encargo:** 2026-09-07

**Inspección local:** 2026-09-08

**Alcance:** exclusivamente código, manifiestos, pruebas y documentación presentes en este árbol; sin Internet y sin ejecutar las aplicaciones comparadas.

## 1. Conclusión ejecutiva

La diferencia más importante no es que Odoo o ERPNext tengan “más pantallas”. Ambos son plataformas ERP extensibles; Bodega es una aplicación operacional especializada. En los snapshots locales, las ventajas verificables más relevantes son:

1. **ERP financiero completo.** ERPNext contiene un núcleo de libro mayor con asientos de reversa, validación de períodos, presupuestos, dimensiones contables y conciliación, más estados financieros y pruebas de salud del ledger. Bodega tiene un módulo sólido de facturación, cobranza, DTE, pagos y conciliación bancaria, pero la inspección acotada no encontró libro mayor general, plan de cuentas, asientos contables ni cierre financiero.
2. **Metamodelo de aplicación.** Odoo registra modelos, campos, vistas, acciones, ACL, reglas de registro y automatizaciones como metadatos componibles. ERPNext describe DocTypes, campos, layouts, estados documentales, permisos, búsqueda y seguimiento en JSON. Bodega sólo tiene un manifiesto de módulo pequeño para navegación, permisos y seed; su lógica viva sigue distribuida entre `lib/` y `app/`.
3. **Extensión sin editar el núcleo.** Odoo ofrece herencia de modelos y vistas, assets y hooks por addon. ERPNext ofrece hooks de DocType, eventos, reemplazo de métodos y clases extendidas. En Bodega el registro central facilita agregar navegación/permisos, pero no hay un contrato equivalente para extender modelos, UI, eventos, jobs y reportes de punta a punta.
4. **Automatización y jobs como plataforma.** Odoo dispone de automatizaciones configurables por modelo y un scheduler con prioridad, próxima/última ejecución, fallos y transacciones aisladas. ERPNext mantiene un catálogo central de eventos horarios/diarios/semanales/mensuales y usa colas para operaciones masivas. Bodega protege bien crons concretos y persiste algunas corridas, pero no hay un subsistema general de jobs con estado, reintentos, progreso, administración y dead-letter.
5. **i18n de producto.** Ambos comparados traen extracción y catálogos PO con referencias de origen. En los archivos de primera parte inspeccionados de Bodega no apareció una infraestructura equivalente; el texto de UI está principalmente codificado en español.
6. **Upgrades como disciplina de producto.** Odoo soporta migraciones por fase y codemods versionados de código; ERPNext conserva una secuencia explícita de patches de datos/esquema. Bodega tiene guardrails de migraciones Drizzle, preflights y despliegue/rollback muy cuidadosos, pero no una capa general de transformaciones versionadas de datos y código con fases y registro semántico de versión.
7. **Experiencias declarativas reutilizables.** Odoo declara vistas lista, formulario, kanban, gráfico y pivot sobre un mismo modelo. ERPNext declara workspaces, onboarding y tours. Bodega tiene un sistema visual y una QA web más explícitos, pero esas experiencias se construyen por página y no se derivan de metadatos de dominio.

Estas son **inferencias comparativas**, no una recomendación de convertir Bodega en un clon de Odoo/Frappe. Las adopciones con mejor relación costo/valor son más pequeñas: un contrato profundo de módulo, un job ledger general, chequeos de integridad de dominio, catálogo de reportes, i18n extraíble y un ledger de upgrades. Un motor contable propio sólo tendría sentido si el alcance del producto cambia explícitamente a ERP financiero; de lo contrario, una integración con un sistema contable es una frontera más prudente.

## 2. Identidad de los snapshots y límites

### 2.1 Snapshots observados

- **Odoo:** el código declara `19.0.0 final`, Python 3.10–3.14 y PostgreSQL 13 o superior (`odoo-19.0/odoo/release.py:9-17`, `odoo-19.0/odoo/release.py:39-41`). El inventario de archivos cambió durante la inspección —el snapshot estaba siendo materializado concurrentemente—, por lo que se omiten conteos exactos de manifests/tests que darían una precisión falsa.
- **ERPNext:** el paquete declara `17.0.0-dev` y `hooks.py` lo identifica como `17.x.x-develop` (`erpnext-develop/erpnext/__init__.py:1-7`, `erpnext-develop/erpnext/hooks.py:41-45`). Su dependencia declara Frappe `>=17.0.0-dev,<18.0.0` (`erpnext-develop/pyproject.toml:44-45`). Se contaron 645 JSON de DocType y 522 archivos `test_*.py`.
- **Bodega:** `package.json` declara `0.1.0`, Node 22.13 y Next.js 16.2.12 (`package.json:1-7`, `package.json:120-128`). El inventario local contiene 338 ocurrencias de `pgTable` y 879 archivos TS/TSX de prueba: 775 unitarios/integración en `app/`, `components/`, `lib/`, `db/` y `scripts/`, más 104 bajo `e2e/`.
- `odoo-19.0/` y `erpnext-develop/` **no son repositorios Git independientes**. Resolver `git` desde ellos devuelve el repositorio padre Bodega; por tanto, no existe un hash upstream local atribuible con rigor.

Los conteos estables son inventario del snapshot, no métricas de calidad ni comparaciones normalizadas. La materialización concurrente de Odoo impide usar su cantidad de archivos como evidencia reproducible.

### 2.2 Limitaciones materiales

1. El snapshot de Odoo no contiene los directorios base `addons/account`, `addons/purchase` ni `addons/stock`, aunque sí contiene addons que dependen de ellos. Por eso este informe **no certifica el motor contable, de compras ni de stock base de Odoo**; sólo usa evidencia local de extensiones, ventas, localización, reportes y framework.
2. El snapshot de ERPNext no incluye el código de Frappe. Los hooks y metadatos prueban el contrato que ERPNext consume, pero no permiten auditar íntegramente el motor genérico de permisos, versiones, colas, formularios o exportación de Frappe.
3. No se levantaron servidores, bases ni navegadores de Odoo/ERPNext. “Hecho” significa visible en fuente primaria local; no significa UAT de runtime.
4. La búsqueda de ausencias en Bodega se acotó a sus fuentes de primera parte (`app/`, `lib/`, `db/`, `modules/`, `scripts/`, `.github/` y documentación relevante). Una ausencia se expresa como “no encontrada en el alcance inspeccionado”, nunca como imposibilidad absoluta.
5. No se compararon precios, SaaS, marketplace comercial, comunidad ni rendimiento real porque exigirían fuentes externas o ejecución. Las licencias sí se registran desde los archivos locales, únicamente como restricción de reutilización y no como análisis jurídico.

### 2.3 Convención de evidencia

- **Hecho:** conducta o estructura explícita en una fuente local citada.
- **Inferencia:** conclusión comparativa derivada de varios hechos; puede requerir decisión de producto.
- **No certificable:** el componente necesario falta del snapshot o requeriría ejecución.
- **Confianza alta:** evidencia positiva en el comparado y contraste directo en Bodega.
- **Confianza media:** la ventaja se apoya además en una búsqueda negativa acotada o en una pieza cuyo framework no está local.

## 3. Base real de Bodega: capacidades que no deben contarse como brechas

Antes de comparar, hay que conservar estas capacidades comprobadas:

- **RBAC y alcance operacional:** roles, permisos, grants directos y relación usuario-faena están modelados explícitamente (`db/schema/users.ts:55-103`).
- **Auditoría e historial:** existe un audit log con estado anterior/nuevo, motivo e IP, además de historial de estados (`db/schema/audit.ts:5-36`). Las notificaciones tienen destino navegable y deduplicación por usuario (`db/schema/audit.ts:51-105`).
- **Workflows fuertes por dominio:** por ejemplo, CAPA valida transición, permiso, evidencia, eficacia, segregación de funciones y cierre sólo tras verificación (`lib/services/prevention-capa.ts:176-235`). Esto es más específico que un workflow genérico y no debe diluirse.
- **Inventario operacional:** hay stock por faena, mínimo no negativo y movimientos con saldo antes/después, referencia y actor (`db/schema/stock.ts:9-50`). La comparación no afirma que Bodega carezca de kardex o control de stock.
- **Facturación/cobranza especializada:** su esquema normaliza proveedores, identidad tributaria, notas de crédito, moneda, pago derivado y decisiones humanas (`db/schema/billing.ts:1-22`, `db/schema/billing.ts:41-123`). Hay corridas persistidas con cursor, contadores, errores y correlación (`db/schema/billing.ts:483-535`) y eventos legibles de factura (`db/schema/billing.ts:537-559`).
- **Compras/DTE ya reconciliado en buena parte:** la auditoría vigente documenta política ordenado/recibido, observabilidad de referencias y notas de crédito ya implementadas (`docs/compras/AUDITORIA_CONCILIADOR_2026-09-06.md:360-363`). Sus pendientes medidos son más acotados: asignación de cantidad/monto cuando una línea de factura se reparte entre líneas de la misma OC, y desglose de impuestos/flete (`docs/compras/AUDITORIA_CONCILIADOR_2026-09-06.md:364-378`).
- **Profundidad operacional propia:** las 338 tablas abarcan, entre otros, faenas, variantes/EPP, SST/prevención, PDTP, DTE, flota, combustibles, TI y mantenimiento. Esto no se reduce a “un inventario simple”; la comparación evalúa patrones de plataforma por encima de esa especialización.
- **Excel:** Bodega genera XLSX con múltiples hojas, sanea nombres, neutraliza fórmulas y congela/filtra encabezados (`lib/reports/export-module/excel-builder.ts:4-25`, `lib/reports/export-module/excel-builder.ts:28-88`, `lib/reports/export-module/excel-builder.ts:99-135`). La regla de producto sigue siendo XLSX-only.
- **Observabilidad general:** instrumenta errores de request con Sentry (`instrumentation.ts:1-17`) y tiene logger JSON con correlación, redacción de PII/secretos y envío seguro a Sentry (`lib/logger.ts:1-24`, `lib/logger.ts:74-165`).
- **Cron seguro:** usa advisory locks de PostgreSQL con conexión reservada y omite ejecuciones solapadas (`lib/services/cron-lock.ts:5-65`). El endpoint Chipax autentica, informa estados por scope y propaga correlation ID (`app/api/cron/chipax-sync/route.ts:21-93`).
- **Testing/CI:** CI separa estáticos, unitarios, PGlite serial, cobertura combinada y PostgreSQL real (`.github/workflows/ci.yml:44-95`, `.github/workflows/ci.yml:96-131`, `.github/workflows/ci.yml:163-227`, `.github/workflows/ci.yml:229-260`).
- **Migración y operación:** Bodega documenta una cadena Drizzle monotónica, prohíbe editar migraciones aplicadas y exige verificación posterior (`db/migrations/README.md:27-55`, `db/migrations/README.md:83-100`). El deploy verifica migraciones y sincroniza RBAC antes de desplegar (`.github/workflows/deploy.yml:17-76`), y la documentación cubre respaldos cifrados y restauración (`docs/deploy/RESPALDOS_Y_RESTAURACION.md:7-44`, `docs/deploy/RESPALDOS_Y_RESTAURACION.md:113-158`).

## 4. Matriz comparativa

| Área | Odoo 19 local | ERPNext 17-dev local | Contraste con Bodega | Juicio |
|---|---|---|---|---|
| Arquitectura/extensibilidad | Addons con dependencias, datos, seguridad, cron, assets y hooks; herencia de modelo/vista | Hooks centrales para JS, clases, métodos, eventos, permisos y scheduler | Manifiesto limitado a nav/permisos/seed; implementación modular pausada | Ambos mejores como plataforma extensible; alta |
| Metadatos | Registro runtime de modelos/campos/vistas/reglas/acciones | DocTypes JSON con UI, permisos, ciclo y tracking | Drizzle + TS explícito; no metamodelo integral | Ambos mejores en capacidad declarativa; alta |
| Workflows | Automatizaciones configurables y triggers amplios | Workflow como datos, roles/condiciones; ciclo submit/cancel | Reglas robustas pero codificadas por servicio | Mejores para configuración/reuso; Bodega puede ser más fuerte en reglas específicas; media-alta |
| Contabilidad/ERP | No certificable por snapshot incompleto | GL, reversas, dimensiones, presupuesto, estados financieros | Facturación/cobranza/DTE sin GL general encontrado | ERPNext claramente mejor; alta |
| Inventario/compras | Evidencia parcial: venta-stock, disponibilidad y rutas | Ledger de stock, locks, valoración, reorden y OC integrada | Kardex/stock/OC operativo, sin ledger de valoración equivalente encontrado | ERPNext mejor en profundidad ERP; alta. Odoo: no certificable en núcleo |
| Permisos | ACL por operación + record rules + restricciones de campo | Permisos por DocType/rol y hooks de query/has_permission | RBAC + faena; política distribuida en servicios | Odoo ofrece una capa más uniforme; ERPNext probable pero Frappe ausente; media |
| Autenticación/MFA/SSO | OAuth2 y LDAP verificables; addon de invitación 2FA presente pero depende de `auth_totp` ausente | No certificable: autenticación pertenece principalmente a Frappe ausente | Credentials + bcrypt + rate limit; sin proveedor MFA/SSO encontrado | Odoo mejor en federación verificable; MFA sólo parcial; media |
| Auditoría | campos de acceso automáticos + chatter/tracking | `track_changes` declarativo y roles de auditor | audit log/historial/eventos explícitos | No hay gap de existencia; comparados ganan en incorporación al metamodelo; media |
| i18n | PO, pluralización, `es_CL`, carga de traducciones | extractores, POT/PO, referencias fuente | No se encontró framework/catálogo equivalente | Ambos mejores; alta |
| UI/UX | Vistas lista/form/kanban/gráfico/pivot y tours declarativos | Workspaces, onboarding, tours y formularios dirigidos por DocType | Design system y reglas fuertes, pero construcción manual por página | Comparados mejores en composición declarativa/onboarding; media-alta |
| Portales externos | Base customer portal y ventas con acceso tokenizado | Rutas de clientes/proveedores para OC, facturas, RFQ y despachos | No se encontró portal general de autoservicio cliente/proveedor | Ambos mejores; ERPNext depende parcialmente de Frappe; media-alta |
| GS1/códigos | Parser GS1-128 con AI, fechas, medidas, FNC1 y dígito de control | Item Barcode enumera GS1/GTIN; parser genérico no certificable | Barcode de producto, sin parser GS1 encontrado | Odoo mejor; ERPNext sólo metadata; alta/media |
| Reportes | Modelos analíticos, QWeb, renderers y export genérico XLSX | Script Reports y estados financieros | Catálogo cerrado de reportes XLSX especializados | Comparados mejores en plataforma de reporting; Bodega mejor alineada con regla XLSX; alta |
| Impresión/BI | QWeb + pivot/gráfico + Spreadsheet integrado | Script Reports/workspaces; impresión genérica depende de Frappe | PDF/print especializados, dashboards y XLSX | Odoo mejor como plataforma BI/impresión; no invalida motores/documentos propios; media-alta |
| Integraciones | Addons aislados, dependencias externas y uninstall hooks | Plaid/EDI y adaptadores por hooks | Varias integraciones especializadas y corridas auditables | Mejores en contrato de plugin; no necesariamente en robustez de cada conector; media |
| Background jobs | Scheduler con prioridad, fallos, transacción, progreso | Catálogo de frecuencias y enqueue masivo | Rutas cron + locks; persistencia sólo en dominios concretos | Ambos mejores como subsistema general; alta |
| Observabilidad | JSON logs, sinks, profiler SQL/stack | Salud automática de ledger y pruebas de corrupción | Sentry, logs redactados, correlation IDs; checks de dominio parciales | Ventajas distintas: Odoo plataforma; ERPNext integridad; Bodega errores/PII. No ganador absoluto |
| Privacidad/indexación | Addon Privacy y campos/modelos indexables/buscables por metadata | `search_index` y global search declarativos; privacidad genérica no certificable sin Frappe | Redacción, cifrado y privacidad SST explícitos; búsqueda/indexación por implementación | Comparados mejores en indexación declarativa; privacidad no tiene ganador único; media |
| Activos/proyectos/soporte | Project y Maintenance instalables; helpdesk completo no verificable en este snapshot | Activos con depreciación, proyectos con costos/progreso y Issues con SLA/portal | Activos TI, custodia, mantenimiento, tickets y feedback; sin depreciación/proyectos financieros | ERPNext más ancho; Bodega más concreta en custodia TI/faena; alta |
| Colaboración por registro | Chatter transversal con mensajes, seguidores, adjuntos, actividades y errores de entrega | Communication/Issue y comentarios; parte genérica depende de Frappe | Auditoría, notificaciones, eventos y comentarios por dominio | Odoo mejor como capacidad transversal; alta |
| Sourcing/proveedores | Núcleo Purchase ausente; no certificable | RFQ, cotización proveedor, OC, recepción/factura y acumulados por línea | Solicitud/OC/recepción/DTE sólidas; sourcing y allocation aún más acotados | ERPNext mejor en ciclo proveedor; alta |
| Documentos/adjuntos | Indexación de ODT/PDF/XLSX/DOCX y almacenamiento cloud desacoplado | Gestión genérica depende de Frappe; adjuntos visibles en flujos concretos | Adjuntos/auditoría y Cloudreve por dominios, sin índice documental global encontrado | Odoo mejor en descubrimiento y storage transversal; media-alta |
| Numeración/multiempresa | Secuencias configurables y consistencia de compañía en ORM | Naming series y variables temporales/fiscales | Folios y scopes resueltos por dominio/faena | Comparados mejores si se requiere configuración o múltiples sociedades; media |
| Amplitud funcional | CRM, e-commerce, POS y MRP presentes como addons | Manufactura, activos, proyectos y soporte integrados al ERP | Especialización operacional; no pretende cubrir cada función ERP | Ventaja condicional al alcance, no deuda automática |
| Testing | Casos transaccionales, HTTP, browser tours, query assertions | CI MariaDB/Postgres con sharding y helpers de reportes | Vitest/PGlite/Postgres/Playwright y cobertura combinada | No gap básico; ERPNext mejor en matriz DB, Odoo en harness integrado; media |
| Gobierno/CI | Harness y packaging maduros; gobierno de PR no caracterizado aquí | pre-commit, Semgrep, test-correctness, docs y matriz DB | CI, gitleaks, auditoría de dependencias, cobertura, QA y deploy/rollback | No gap general; hay prácticas transferibles en ambos sentidos; media |
| Migraciones/upgrades | Fases y codemods versionados | `patches.txt` secuencial antes/después de sync | Drizzle robusto, preflights y baseline; sin codemods/patch ledger semántico | Comparados mejores en upgrade de producto; alta |
| Documentación/operación | Unidad systemd/config; README general ausente | README de managed/self-host/dev, seguridad, Docker CI | Deploy/rollback/backup muy documentados | ERPNext mejor en onboarding técnico; Bodega fuerte en operación propia; media |

## 5. Hallazgos detallados

### 5.1 Arquitectura y extensibilidad

**Hechos Odoo.** Un addon declara en una sola unidad dependencias, ACL/data, reportes, cron, vistas, demos, assets backend/frontend/test, hook y licencia (`odoo-19.0/addons/sale/__manifest__.py:3-64`, `odoo-19.0/addons/sale/__manifest__.py:65-108`). Un módulo puede extender `purchase.order` con `_inherit` sin copiar el modelo (`odoo-19.0/addons/project_purchase/models/purchase_order.py:3-9`) y extender su vista por XML con restricción de grupo (`odoo-19.0/addons/project_purchase/views/purchase_order.xml:3-12`). El cargador distingue instalación, upgrade, reinicialización y demo, arma el grafo y ejecuta scripts previos al upgrade (`odoo-19.0/odoo/modules/loading.py:340-429`).

**Hechos ERPNext.** `hooks.py` expone JS por DocType, clases extendidas, métodos whitelisted reemplazados, hooks de instalación/sesión, eventos documentales, permisos y scheduler (`erpnext-develop/erpnext/hooks.py:43-96`, `erpnext-develop/erpnext/hooks.py:329-353`, `erpnext-develop/erpnext/hooks.py:385-461`, `erpnext-develop/erpnext/hooks.py:485-552`). El mapa de módulos enumera 21 dominios funcionales (`erpnext-develop/erpnext/modules.txt:1-21`).

**Hechos Bodega.** El manifiesto sólo cubre id, permisos, metadatos de permiso, navegación, seed y grants (`modules/manifest-types.ts:3-45`). El registro es un único punto de unión (`modules/registry.ts:1-8`, `modules/registry.ts:35-74`), pero la propia documentación declara pausada e incompleta la migración modular y mantiene `lib/` + `app/` como fuente de verdad (`modules/README.md:1-20`).

**Inferencia.** Odoo y ERPNext hacen mejor el **contrato de extensión transversal**. La brecha no se cierra agregando más campos al manifiesto mientras los consumidores sigan acoplados; requiere una costura estable que sea dueña de modelo, políticas, eventos, jobs, reportes y UI pública. Confianza alta.

### 5.2 Modelo de metadatos

**Hechos Odoo.** `ir.model` conserva nombre, orden, descripción, campos, herencias, acceso, reglas, vistas y conteos (`odoo-19.0/odoo/addons/base/models/ir_model.py:215-277`). Los descriptores de campo incluyen etiqueta, ayuda, required/readonly, índices, defaults, grupos, traducción, compute/inverse/related y metadatos de UI (`odoo-19.0/odoo/orm/fields.py:92-155`, `odoo-19.0/odoo/orm/fields.py:250-304`). Las vistas se combinan por herencia y el motor detecta locators inválidos (`odoo-19.0/odoo/addons/base/models/ir_ui_view.py:322-390`).

**Hechos ERPNext.** El DocType Item declara orden y secciones de campos, tipos, links, restricciones, defaults y dependencias (`erpnext-develop/erpnext/stock/doctype/item/item.json:1-11`, `erpnext-develop/erpnext/stock/doctype/item/item.json:12-180`). La OC agrega submittable, permisos por rol/operación, búsqueda, timeline y `track_changes` en el mismo artefacto (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1297-1357`). Python genera una superficie de tipos desde esos metadatos (`erpnext-develop/erpnext/stock/doctype/item/item.py:54-149`).

**Inferencia.** Ambos reducen la duplicación entre esquema, formulario, permisos, búsqueda y auditoría. Bodega conserva claridad y tipado explícito, pero paga integración manual y deriva menos comportamiento. Un metamodelo total sería riesgoso; una primera mejora razonable es generar sólo artefactos repetitivos desde contratos tipados, conservando reglas de negocio en servicios profundos. Confianza alta.

### 5.3 Workflows y automatización

**Hechos Odoo.** `base.automation` apunta a cualquier modelo, enlaza acciones/webhook y opcionalmente registra ejecuciones (`odoo-19.0/addons/base_automation/models/base_automation.py:124-148`). Sus triggers cubren cambios de etapa/usuario/tag/estado/prioridad, archivado, create/update/delete, UI, tiempo, mensajes y webhook (`odoo-19.0/addons/base_automation/models/base_automation.py:150-180`); al cambiar automatizaciones actualiza cron y registry (`odoo-19.0/addons/base_automation/models/base_automation.py:490-520`).

**Hechos ERPNext.** Las pruebas crean workflows como datos con estados, rol que puede editar, transiciones, rol aprobador, autoaprobación y condición por importe (`erpnext-develop/erpnext/selling/doctype/sales_order/test_sales_order.py:3793-3831`). La OC implementa mappings de estado y, al submit/cancel, actualiza solicitudes, cantidades, presupuesto, autoridad e intercompany (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.py:411-418`, `erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.py:433-535`).

**Contraste.** Bodega tiene workflows más ricos que una simple enum, pero incrustados por dominio; CAPA es un ejemplo (`lib/services/prevention-capa.ts:193-235`).

**Inferencia.** Los comparados hacen mejor la **configuración y reutilización**. No conviene mover a metadatos condiciones de seguridad complejas como segregación/evidencia; sí conviene un motor común de transición que centralice estado actual, permiso, motivo, evento y side effects transaccionales, permitiendo extensiones codificadas. Confianza media-alta.

### 5.4 Contabilidad y alcance ERP

**Odoo: no certificable.** El snapshot describe Odoo como ERP con contabilidad (`odoo-19.0/odoo/release.py:19-25`) y contiene localización chilena dependiente de `account` (`odoo-19.0/addons/l10n_cl/__manifest__.py:3-22`), pero falta `addons/account`. No se atribuye aquí una ventaja funcional no inspeccionable.

**Hechos ERPNext.** El posting central valida presupuesto, período, cuentas y dimensiones; crea payment ledger y revierte en cancelación (`erpnext-develop/erpnext/accounts/general_ledger.py:34-74`). Balancea dimensiones contables (`erpnext-develop/erpnext/accounts/general_ledger.py:77-138`), distribuye centros de costo y valida presupuesto (`erpnext-develop/erpnext/accounts/general_ledger.py:141-196`), y genera reversas de ledger inmutable (`erpnext-develop/erpnext/accounts/general_ledger.py:607-724`). GL Entry modela débito/crédito en moneda de cuenta y transacción, año fiscal, centro de costo y voucher (`erpnext-develop/erpnext/accounts/doctype/gl_entry/gl_entry.py:30-73`). El workspace enlaza Balance Sheet, P&L, Cash Flow, Trial Balance, consolidado y GL (`erpnext-develop/erpnext/accounts/workspace/financial_reports/financial_reports.json:49-169`).

**Hechos Bodega.** Facturación distingue ventas/compras, maneja DTE, pagos, bancos, conciliación, propuestas y cobranzas (`db/schema/billing.ts:31-123`, `db/schema/billing.ts:249-463`). El registro rotula el módulo como “Facturación y Cobranza (cuentas por cobrar)” (`modules/registry.ts:53-56`). En la búsqueda de 2.775 archivos TS/TSX de primera parte no aparecieron modelos o servicios denominados general ledger, journal entry, chart of accounts o asiento contable.

**Inferencia.** ERPNext hace mejor contabilidad general, cierre y estados financieros. Es una brecha de alcance, no necesariamente un defecto. Si Bodega necesita emitir contabilidad oficial, la opción por defecto debería ser una integración con un ERP/contabilidad y una frontera contable bien definida; construir un GL requiere invariantes, reversas, períodos, moneda, dimensiones y conciliación desde el día uno. Confianza alta.

### 5.5 Inventario, valoración, compras y reabastecimiento

**Hechos Odoo parciales.** `sale_stock` enlaza ventas con transferencias y calcula entrega pendiente/parcial/iniciada/completa (`odoo-19.0/addons/sale_stock/models/sale_order.py:90-103`). Exige bodega para productos almacenables y respeta compañía/ruta (`odoo-19.0/addons/sale_stock/models/sale_order.py:130-152`). Distingue disponibilidad actual, libre y proyectada por producto/bodega/fecha (`odoo-19.0/addons/sale_stock/models/sale_order_line.py:68-77`, `odoo-19.0/addons/sale_stock/models/sale_order_line.py:126-145`). No se certifica el núcleo ausente.

**Hechos ERPNext.** La OC valida proveedor, fecha, UOM entera, documento previo, mínimo, blanket order e intercompany (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.py:203-228`) y al submit actualiza upstream, cantidades, presupuesto y aprobaciones (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.py:433-457`). El stock ledger bloquea item-bodega en orden estable, impide períodos cerrados, crea asientos, recalcula valoración y actualiza Bin (`erpnext-develop/erpnext/stock/stock_ledger.py:103-199`, `erpnext-develop/erpnext/stock/stock_ledger.py:299-318`). Reorden compara proyectado con nivel y calcula déficit (`erpnext-develop/erpnext/stock/reorder_item.py:36-74`).

**Hechos Bodega.** El esquema conserva saldo por faena, mínimo y movimientos con before/after (`db/schema/stock.ts:9-50`); existen pruebas específicas de concurrencia y servicios de stock listadas en `lib/__tests__/stock-concurrency-postgres.test.ts` y `lib/__tests__/stock-service.test.ts`.

**Inferencia.** ERPNext hace mejor la valoración contable, el reposting temporal y el planeamiento de abastecimiento. Bodega no necesita reemplazar su identidad producto-variante-faena ni su trazabilidad concreta; puede adoptar tres patrones aislados: cantidad proyectada, bloqueo determinista por item-faena y chequeo/repost de ledger con evidencia. Confianza alta.

### 5.6 Permisos y auditoría

**Hechos Odoo.** Las ACL separan read/write/create/delete y evalúan grupos efectivos (`odoo-19.0/odoo/addons/base/models/ir_model.py:2080-2093`, `odoo-19.0/odoo/addons/base/models/ir_model.py:2141-2176`). Las record rules combinan reglas globales y de grupos (`odoo-19.0/odoo/addons/base/models/ir_rule.py:113-173`), y los campos pueden restringirse por grupo (`odoo-19.0/odoo/orm/fields.py:124-132`). El ORM completa `write_uid`/`write_date` al escribir (`odoo-19.0/odoo/orm/models.py:4384-4402`); chatter registra mensajes/seguidores y tracking de campos (`odoo-19.0/addons/mail/models/mail_thread.py:104-168`, `odoo-19.0/addons/mail/models/mail_tracking_value.py:35-150`).

**Hechos ERPNext.** La OC declara read/report/amend/cancel/create/delete/email/print/share/submit/write por rol y permlevel (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1308-1347`). Hooks agregan filtros y `has_permission` por entidad (`erpnext-develop/erpnext/hooks.py:329-353`). `track_changes` está activo en OC y Journal Entry (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1350-1357`, `erpnext-develop/erpnext/accounts/doctype/journal_entry/journal_entry.json:682-727`), pero sin Frappe no se certifica su almacenamiento.

**Contraste.** Bodega ya modela RBAC, grants directos y alcance por faena (`db/schema/users.ts:55-103`) y audit/status history (`db/schema/audit.ts:5-36`).

**Inferencia.** La ventaja de Odoo no es “tener permisos”, sino aplicarlos uniformemente desde el ORM a modelo, fila y campo. En Bodega, mantener la política de faena explícita es correcto, pero una interfaz única de scope/autorización por servicio reduciría el riesgo de omisiones. Auditoría no es un gap de existencia; sí lo es su incorporación automática a contratos de entidad. Confianza media-alta para Odoo, media para ERPNext.

### 5.7 Internacionalización y localización

**Hechos Odoo.** El loader valida idioma y carga traducciones almacenadas de modelos/términos (`odoo-19.0/odoo/tools/translate.py:1560-1650`). El catálogo de venta en español incluye pluralización y referencias (`odoo-19.0/addons/sale/i18n/es.po:1-31`), y existen catálogos `es_CL`. La localización chilena agrega chart data, impuestos, tipos de documento, monedas, bancos y países (`odoo-19.0/addons/l10n_cl/__manifest__.py:3-49`).

**Hechos ERPNext.** Declara extractores para setup data, Incoterms, TS y TSX (`erpnext-develop/babel_extractors.csv:1-5`) y configuración de traducción (`erpnext-develop/erpnext/hooks.py:760-764`). `es.po` conserva metadatos y referencias exactas a origen (`erpnext-develop/erpnext/locale/es.po:1-40`).

**Contraste e inferencia.** `package.json` no incluye una librería i18n y las búsquedas por `next-intl`, `react-intl`, `i18next`, `useTranslations` y catálogos PO no arrojaron implementación de primera parte. Ambos comparados hacen mejor extracción, traducción, pluralización y localización. Aunque Bodega opere sólo en Chile, separar etiquetas, formatos, plurales y textos regulatorios facilitaría consistencia y cambios terminológicos. Confianza alta.

### 5.8 UI/UX y configuración de experiencia

**Hechos Odoo.** Una misma entidad de venta ofrece gráfico, pivot y kanban declarativos (`odoo-19.0/addons/sale/views/sale_order_views.xml:45-95`). La vista de formulario condiciona acciones por estado/permisos, añade confirmaciones y statusbar (`odoo-19.0/addons/sale/views/sale_order_views.xml:252-379`). El addon declara tours y pruebas JS en bundles separados (`odoo-19.0/addons/sale/__manifest__.py:91-105`).

**Hechos ERPNext.** El workspace contable declara charts, cards, onboarding y enlaces (`erpnext-develop/erpnext/accounts/workspace/accounting/accounting.json:1-46`, `erpnext-develop/erpnext/accounts/workspace/accounting/accounting.json:48-240`). Buying onboarding guía Supplier → Item → Purchase Order → Purchase Invoice → análisis/configuración (`erpnext-develop/erpnext/buying/module_onboarding/buying_onboarding/buying_onboarding.json:1-40`), y hay un form tour declarativo para Supplier (`erpnext-develop/erpnext/buying/form_tour/supplier_form_tour/supplier_form_tour.json:1-41`).

**Inferencia.** Los comparados hacen mejor la derivación de experiencias coherentes y el onboarding contextual. Bodega tiene reglas UI propias más estrictas y adecuadas a su operación; debería reutilizar el patrón de tour/onboarding declarativo y definiciones de vista sólo donde disminuyan duplicación, sin perder PageHeader, TopBar, densidad ni accesibilidad. Confianza media-alta.

### 5.9 Reportes y exportación

**Hechos Odoo.** `sale.report` es un modelo analítico read-only con dimensiones, variantes, cantidades, estados y medidas monetarias (`odoo-19.0/addons/sale/report/sale_report.py:8-34`, `odoo-19.0/addons/sale/report/sale_report.py:50-89`). Las acciones de reporte soportan QWeb, paperformat y nombre traducido, con renderizadores PDF/HTML/text (`odoo-19.0/odoo/addons/base/models/ir_actions_report.py:157-186`, `odoo-19.0/odoo/addons/base/models/ir_actions_report.py:1019-1119`). El exportador genérico permite selección de campos, relaciones y listas guardadas, registra quién exportó y genera XLSX tipado (`odoo-19.0/addons/web/controllers/export.py:167-195`, `odoo-19.0/addons/web/controllers/export.py:364-515`, `odoo-19.0/addons/web/controllers/export.py:616-623`, `odoo-19.0/addons/web/controllers/export.py:686-723`). También ofrece CSV, patrón que **no se adopta** por la regla XLSX-only de Bodega.

**Hechos ERPNext.** General Ledger es un Script Report ligado a GL Entry y habilitado a Accounts User/Manager/Auditor (`erpnext-develop/erpnext/accounts/report/general_ledger/general_ledger.json:1-42`); valida compañía, fechas, cuentas y combinaciones de filtros (`erpnext-develop/erpnext/accounts/report/general_ledger/general_ledger.py:29-86`). La aplicación provee estilos XLSX para estados financieros (`erpnext-develop/erpnext/accounts/report/profit_and_loss_statement/profit_and_loss_statement.py:9-12`), aunque una prueba local usa CSV (`erpnext-develop/erpnext/accounts/report/profit_and_loss_statement/test_profit_and_loss_statement.py:167-183`), por lo que no es precedente para Bodega.

**Hechos Bodega.** `getReportData` despacha un conjunto cerrado de reportes especializados (`lib/reports/export-module/dispatcher.ts:1-49`); `ReportData` admite varias hojas (`lib/reports/export-module/types.ts:1-31`) y Excel está saneado (`lib/reports/export-module/excel-builder.ts:83-135`).

**Inferencia.** Odoo/ERPNext hacen mejor la plataforma de reporting reusable; Bodega hace mejor el cumplimiento consciente de XLSX seguro para su alcance. El siguiente paso útil es un registro tipado de definiciones de reporte —permiso, alcance, filtros, columnas, formatos, límite y auditoría—, no un constructor SQL arbitrario para usuarios. Confianza alta.

### 5.10 Integraciones

**Hechos Odoo.** OAuth2 se encapsula como addon con seguridad, vistas y assets (`odoo-19.0/addons/auth_oauth/__manifest__.py:5-23`). Google Cloud Storage declara dependencias externas, assets y uninstall hook (`odoo-19.0/addons/cloud_storage_google/__manifest__.py:3-25`). UBL Bis 3 extiende Purchase Order por herencia y registra un decoder (`odoo-19.0/addons/purchase_edi_ubl_bis3/models/purchase_order.py:4-30`).

**Hechos ERPNext.** `pyproject.toml` incluye dependencias explícitas para Google Maps, Plaid, YouTube, MT940 y extracción de cartolas PDF (`erpnext-develop/pyproject.toml:10-31`). Plaid protege mutaciones POST, mapea cuentas usando savepoints/rollback y puede encolar sincronización (`erpnext-develop/erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:40-58`, `erpnext-develop/erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:98-183`, `erpnext-develop/erpnext/erpnext_integrations/doctype/plaid_settings/plaid_settings.py:325-339`). EDI importa genericode y resuelve versiones canónicas (`erpnext-develop/erpnext/edi/doctype/code_list/code_list.py:66-169`).

**Contraste.** Bodega tiene conectores DTE, Chipax, combustibles, Onway, Cloudreve, Drive y correo; Chipax normaliza proveedores y registra corridas con correlación (`db/schema/billing.ts:1-22`, `db/schema/billing.ts:483-535`).

**Inferencia.** La ventaja comparable es el **aislamiento contractual** de cada integración como módulo instalable con lifecycle y dependencias, no la mera cantidad. Bodega puede profundizar su buena normalización con una interfaz común: capabilities, health, sync cursor, idempotencia, secrets, retention, uninstall/disable y observabilidad. Confianza media.

### 5.11 Background jobs

**Hechos Odoo.** `ir.cron` conserva usuario, activo, intervalo, próxima/última ejecución, prioridad y fallos consecutivos (`odoo-19.0/odoo/addons/base/models/ir_cron.py:91-127`). Los jobs corren en transacción dedicada; el runner distingue completo/parcial/fallido, admite progreso por lotes y reprograma o desactiva (`odoo-19.0/odoo/addons/base/models/ir_cron.py:399-451`).

**Hechos ERPNext.** `scheduler_events` concentra cron exacto y tareas hourly/daily/weekly/monthly, incluyendo valoración, Plaid, ledger health, reorder y deferred accounting (`erpnext-develop/erpnext/hooks.py:485-552`). Bulk Transaction verifica permisos, encola trabajo, usa savepoint por registro, reintenta fallos seleccionados y persiste resultado (`erpnext-develop/erpnext/utilities/bulk_transaction.py:9-50`, `erpnext-develop/erpnext/utilities/bulk_transaction.py:53-125`, `erpnext-develop/erpnext/utilities/bulk_transaction.py:192-203`). La semántica de cola subyacente no es certificable sin Frappe.

**Hechos Bodega.** `withCronLock` evita solapamiento, pero su contrato retorna resultado/skipped y no persiste por sí mismo prioridad, reintentos, progreso o fallos (`lib/services/cron-lock.ts:30-87`). Algunos dominios sí lo hacen: Billing Sync Run almacena estado, cursor, contadores y errores (`db/schema/billing.ts:483-535`).

**Inferencia.** Ambos comparados hacen mejor el subsistema general. La solución profunda es que el job ledger absorba scheduling, lease/lock, idempotency key, attempts, cursor/progress, result, actor/correlation y retention; los handlers de dominio sólo ejecutan trabajo. Confianza alta.

### 5.12 Observabilidad e integridad operacional

**Hechos Odoo.** El formatter JSON serializa mensaje, excepción, stack y metadatos de test (`odoo-19.0/odoo/logging.py:14-75`). Configuración admite archivo, syslog, niveles por módulo y logging HTTP/SQL/DB/JSON (`odoo-19.0/odoo/tools/config.py:318-344`). El profiler captura SQL y trazas asíncronas (`odoo-19.0/odoo/tools/profiler.py:508-580`).

**Hechos ERPNext.** Un job de salud recorre compañías y persiste vouchers con desbalance débito/crédito o discrepancia GL/Payment Ledger (`erpnext-develop/erpnext/accounts/utils.py:2663-2701`). Las pruebas corrompen intencionalmente ambos ledgers y verifican la detección (`erpnext-develop/erpnext/accounts/doctype/ledger_health/test_ledger_health.py:37-107`).

**Hechos Bodega.** Logger y Sentry ya cubren errores con redacción (`lib/logger.ts:1-24`, `lib/logger.ts:138-165`, `lib/sentry.ts:13-42`); corridas de billing tienen métricas/correlación (`db/schema/billing.ts:483-535`). La documentación de backup define verificación real de descifrado y severidades OK/WARNING/CRITICAL (`docs/deploy/RESPALDOS_Y_RESTAURACION.md:113-129`).

**Inferencia.** No hay ganador absoluto. Odoo aporta profiler/sinks; Bodega es más explícita en PII y Sentry; ERPNext ofrece el patrón más valioso para adoptar: **monitores de invariantes de negocio** que introducen corrupción controlada en tests y producen hallazgos accionables. Aplicaciones: stock before/after, OC-recepción-factura, DTE-pago, cobertura EPP y eventos PDTP. Confianza alta para ese patrón.

### 5.13 Testing y calidad

**Hechos Odoo.** El harness contiene TransactionCase, HttpCase, tags install/post-install, conteo de queries y tours de browser (`odoo-19.0/odoo/tests/common.py:310-317`, `odoo-19.0/odoo/tests/common.py:531-610`, `odoo-19.0/odoo/tests/common.py:990`, `odoo-19.0/odoo/tests/common.py:2196`, `odoo-19.0/odoo/tests/common.py:2450-2583`, `odoo-19.0/odoo/tests/common.py:2712-2729`).

**Hechos ERPNext.** CI ejecuta MariaDB en PR/diario y reparte tests en cuatro shards (`erpnext-develop/.github/workflows/server-tests-mariadb.yml:1-20`, `erpnext-develop/.github/workflows/server-tests-mariadb.yml:150-228`); Postgres se ejecuta diario o por etiqueta, también en shards (`erpnext-develop/.github/workflows/server-tests-postgres.yml:1-17`, `erpnext-develop/.github/workflows/server-tests-postgres.yml:141-200`). Linters incluyen pre-commit, Semgrep y corrección de tests (`erpnext-develop/.github/workflows/linters.yml:1-48`).

**Hechos Bodega.** CI alinea runtime/timezone, escanea secretos, typecheck/lint, separa suites, une cobertura y usa Postgres real (`.github/workflows/ci.yml:23-41`, `.github/workflows/ci.yml:44-95`, `.github/workflows/ci.yml:163-260`). Los 775+104 archivos indican amplitud, no tasa de éxito de esta inspección.

**Inferencia.** No existe una brecha de cultura de pruebas demostrada. Odoo hace mejor la integración de pruebas transaccionales/HTTP/tours y assertions de queries en un harness; ERPNext hace mejor la matriz MariaDB/Postgres. Bodega ya supera a una comparación superficial con PGlite, Postgres y Playwright. Conviene adoptar assertions de presupuesto de queries y health-corruption tests, no perseguir conteos. Confianza media.

### 5.14 Migraciones y upgrades

**Hechos Odoo.** El gestor reconoce scripts `migrate(cr, installed_version)` y fases pre/post/end, seleccionados y ejecutados por versión (`odoo-19.0/odoo/modules/migration.py:58-87`, `odoo-19.0/odoo/modules/migration.py:149-215`). `upgrade_code` aplica scripts versionados con dry-run (`odoo-19.0/odoo/cli/upgrade_code.py:1-29`, `odoo-19.0/odoo/cli/upgrade_code.py:132-173`); un codemod real convierte `tree` a `list` en XML/JS/Python (`odoo-19.0/odoo/upgrade_code/17.5-01-tree-to-list.py:4-35`).

**Hechos ERPNext.** `patches.txt` separa `pre_model_sync` y mantiene una secuencia de patches de datos/esquema, incluidas reconstrucciones, cantidades, dimensiones y reposting (`erpnext-develop/erpnext/patches.txt:1-47`, `erpnext-develop/erpnext/patches.txt:127-136`).

**Hechos Bodega.** Drizzle documenta el incidente del journal y sus reglas correctivas (`db/migrations/README.md:3-25`, `db/migrations/README.md:27-55`); scripts y deploy verifican/aplican migraciones (`package.json:27-33`, `.github/workflows/deploy.yml:17-49`).

**Inferencia.** Bodega es fuerte en integridad del esquema, pero los comparados hacen mejor el **upgrade de producto**: orden semántico, fases, transformaciones de datos y codemods de consumidores. Un ledger de upgrades no debe reemplazar Drizzle; debe envolver pasos pre-schema/post-schema/reconcile/verify/rollback-compatibility con versionado y reanudación. Confianza alta.

### 5.15 Documentación y operaciones

**Hechos Odoo.** El paquete Debian incluye unidad systemd con usuario/grupo, config y logfile (`odoo-19.0/debian/odoo.service:1-13`) y configuración separada de credencial administrativa/PostgreSQL (`odoo-19.0/debian/odoo.conf:1-9`). El snapshot no trae README general; `README.Debian` documenta una limitación de wkhtmltopdf (`odoo-19.0/debian/README.Debian:1-10`).

**Hechos ERPNext.** README separa hosting administrado, Docker self-host y demo descartable (`erpnext-develop/README.md:60-109`) y documenta instalación de desarrollo con Bench/site/app (`erpnext-develop/README.md:114-146`). Hay política de seguridad (`erpnext-develop/SECURITY.md:1-7`) y workflow de documentación (`erpnext-develop/.github/workflows/docs-checker.yml:1-28`).

**Hechos Bodega.** El deploy construye una imagen inmutable, migra, sincroniza RBAC y contempla rollback seguro (`.github/workflows/deploy.yml:17-76`, `.github/workflows/deploy.yml:78-125`, `.github/workflows/deploy.yml:156-220`). Backup/restore está documentado con cifrado, retención y ensayo (`docs/deploy/RESPALDOS_Y_RESTAURACION.md:27-44`, `docs/deploy/RESPALDOS_Y_RESTAURACION.md:104-129`, `docs/deploy/RESPALDOS_Y_RESTAURACION.md:131-167`).

**Inferencia.** ERPNext hace mejor el onboarding general de desarrollador/operador. Bodega hace mejor la documentación contextual de su operación real y riesgos de restauración. La mejora concreta es un README raíz con arquitectura, setup reproducible, mapa de módulos, comandos canónicos y enlaces a runbooks; no reemplazar los runbooks específicos. Confianza media.

### 5.16 Autenticación, MFA y SSO

**Hechos Odoo.** `auth_oauth` habilita login por proveedor OAuth2 (`odoo-19.0/addons/auth_oauth/__manifest__.py:4-23`) y `auth_ldap` declara autenticación LDAP y sus dependencias (`odoo-19.0/addons/auth_ldap/__manifest__.py:3-20`). Existe una extensión de invitación 2FA y pruebas del flujo, pero depende de `auth_totp`, cuyo directorio base no está en el snapshot (`odoo-19.0/addons/auth_totp_mail/__manifest__.py:1-24`); por ello no se certifica el motor MFA completo.

**ERPNext: no certificable.** El app importa `frappe` y el snapshot no contiene ese framework; no se atribuye soporte MFA, OAuth, LDAP o SAML basándose en conocimiento externo.

**Hechos Bodega.** NextAuth configura únicamente Credentials con email/password, bcrypt, hash señuelo contra enumeración y rate limiting persistente (`lib/auth/auth.ts:20-35`, `lib/auth/auth.ts:57-129`). La búsqueda acotada no encontró un segundo proveedor de login, TOTP, WebAuthn, OAuth/OIDC, SAML o LDAP de primera parte. El 2FA mencionado en Aramco es del proveedor de combustible, no del login Bodega.

**Inferencia.** Odoo hace mejor federación de identidad de forma verificable. Para Bodega, MFA y SSO serían mejoras de seguridad/gobierno, no una razón para migrar de plataforma. Prioridad depende de identidad corporativa disponible; si existe IdP, OIDC con enforcement central suele ser una costura más profunda que implementar TOTP local. Confianza media.

### 5.17 Portales externos

**Hechos Odoo.** `portal` aporta controlador y templates base extensibles para un customer portal (`odoo-19.0/addons/portal/__manifest__.py:4-27`). Ventas expone cotizaciones/órdenes paginadas con dominio del partner y verificación de acceso; el detalle público valida access token y puede renderizar HTML/PDF/text (`odoo-19.0/addons/sale/controllers/portal.py:15-41`, `odoo-19.0/addons/sale/controllers/portal.py:48-116`, `odoo-19.0/addons/sale/controllers/portal.py:122-153`).

**Hechos ERPNext.** `website_route_rules` mapea órdenes, facturas, supplier quotations, purchase orders/invoices, quotations, shipments, RFQ, addresses, BOM, timesheets y material requests a vistas externas (`erpnext-develop/erpnext/hooks.py:142-234`). Issue conserva si fue creado por customer portal (`erpnext-develop/erpnext/support/doctype/issue/issue.json:9-58`).

**Contraste e inferencia.** El inventario de rutas Bodega no mostró una capa general de autoservicio de clientes/proveedores comparable. Sí existen integraciones con portales externos y rutas de impresión/API; no son lo mismo que un portal propio. Ambos comparados hacen mejor esta superficie. Sólo adoptarla si hay casos concretos —acuse, cotización proveedor, estado de OC/factura—, con scopes y tokens por documento; no abrir la aplicación interna. Confianza media-alta.

### 5.18 GS1 y códigos de barras

**Hechos Odoo.** El addon GS1 declara parser GS1-128 y reglas/assets/tests (`odoo-19.0/addons/barcodes_gs1_nomenclature/__manifest__.py:3-24`). El parser entiende FNC1, Application Identifiers, fechas, medidas con decimales, identificadores con dígito de control y descomposición múltiple (`odoo-19.0/addons/barcodes_gs1_nomenclature/models/barcode_nomenclature.py:10-30`, `odoo-19.0/addons/barcodes_gs1_nomenclature/models/barcode_nomenclature.py:33-97`, `odoo-19.0/addons/barcodes_gs1_nomenclature/models/barcode_nomenclature.py:99-140`).

**Hechos ERPNext.** Item Barcode tipa EAN, UPC, GS1, GTIN/GTIN-14 e ISBN, entre otros (`erpnext-develop/erpnext/stock/doctype/item_barcode/item_barcode.py:17-39`, `erpnext-develop/erpnext/stock/doctype/item_barcode/item_barcode.json:12-35`). El código local prueba metadata/almacenamiento, no un parser GS1 equivalente.

**Contraste e inferencia.** `products` usa SKU y variantes, pero no expone barcode/GTIN/GS1 en el esquema inspeccionado (`db/schema/products.ts:42-89`). Odoo hace mejor captura logística estandarizada; ERPNext hace mejor clasificación básica. En Bodega sólo es prioridad si recepción/EPP por lote requiere escaneo de GTIN, lote y vencimiento; en ese caso conviene un parser GS1 aislado antes que campos ad hoc. Confianza alta para Odoo, media para ERPNext.

### 5.19 Impresión y BI

**Hechos Odoo.** Además de QWeb y renderers citados en 5.9, Spreadsheet integra modelos graph/pivot, Chart.js, app pública read-only, impresión, plugins y migraciones (`odoo-19.0/addons/spreadsheet/__manifest__.py:3-35`, `odoo-19.0/addons/spreadsheet/__manifest__.py:37-100`).

**Hechos ERPNext.** Workspaces y Script Reports cubren navegación analítica y estados financieros (`erpnext-develop/erpnext/accounts/workspace/financial_reports/financial_reports.json:49-169`, `erpnext-develop/erpnext/accounts/report/general_ledger/general_ledger.json:1-42`). El motor genérico de Print Format pertenece a Frappe y no se certifica aquí.

**Hechos Bodega.** Hay rutas especializadas de impresión/PDF para OC, guías, entregas, SST, inspecciones y actas TI bajo `app/(print)/`; las dependencias incluyen jsPDF y Takumi PDF (`package.json:114-135`). También tiene dashboards Recharts y exportación XLSX.

**Inferencia.** Odoo hace mejor BI self-service integrado y composición de impresión genérica. No existe evidencia para afirmar que sus documentos concretos sean mejores que los de Bodega. La mejora selectiva sería un contrato común de documento imprimible y datasets analíticos gobernados; no una hoja de cálculo que pueda evadir scopes. Confianza media-alta.

### 5.20 Privacidad, búsqueda e indexación

**Hechos Odoo.** `privacy_lookup` aporta wizard, logs, ACL y acción de servidor (`odoo-19.0/addons/privacy_lookup/__manifest__.py:4-17`). Campos y modelos declaran búsqueda/exportación/indexación y restricciones de grupo desde metadata (`odoo-19.0/odoo/orm/fields.py:92-155`, `odoo-19.0/odoo/addons/base/models/ir_model.py:215-277`).

**Hechos ERPNext.** DocTypes marcan campos para `search_index`, `in_global_search`, filtros y listas; Project e Issue son ejemplos (`erpnext-develop/erpnext/projects/doctype/project/project.json:71-124`, `erpnext-develop/erpnext/support/doctype/issue/issue.json:59-121`). `hooks.py` mantiene un catálogo central de global search (`erpnext-develop/erpnext/hooks.py:691-733`). La privacidad genérica de Frappe no se certifica.

**Hechos Bodega.** La privacidad es especialmente fuerte en SST: payload clínico/casos reservados cifrados, membresía por propósito, auditoría de accesos concedidos/denegados y solicitudes de acceso/rectificación/eliminación/oposición/portabilidad/restricción con legal hold (`db/schema/prevention/privacy.ts:8-44`, `db/schema/prevention/privacy.ts:46-122`, `db/schema/prevention/privacy.ts:124-177`). El logger redacta PII/secretos (`lib/logger.ts:1-24`). Búsqueda e índices se implementan por página/esquema, no desde un metamodelo global.

**Inferencia.** No hay gap general de privacidad; Bodega es más explícita para datos sensibles locales. Odoo/ERPNext hacen mejor la indexación/búsqueda declarativa. Una mejora segura sería un registro central de campos buscables con scope y clasificación de sensibilidad, evitando indexar contenido clínico o reservado. Confianza media.

### 5.21 Activos, proyectos y soporte

**Hechos Odoo.** Project declara seguridad, reportes, sharing/portal, milestones, cron, tours, templates y hooks (`odoo-19.0/addons/project/__manifest__.py:13-70`); Maintenance modela equipos y solicitudes con seguridad, mail y tours (`odoo-19.0/addons/maintenance/__manifest__.py:3-35`). No se encontró un addon Helpdesk base completo en este snapshot, por lo que no se le atribuye.

**Hechos ERPNext.** Asset reúne compra, ubicación, seguro, custodio, finance books, depreciación y asiento de scrap (`erpnext-develop/erpnext/assets/doctype/asset/asset.json:10-87`). El job de depreciación procesa activos, contabiliza por dimensiones y registra/notifica fallos (`erpnext-develop/erpnext/assets/doctype/asset/depreciation.py:37-79`). Project incorpora plantilla, progreso, fechas, costos, ventas, facturación, margen, notificaciones y usuarios (`erpnext-develop/erpnext/projects/doctype/project/project.json:10-70`). Issue integra email, cliente, prioridad, SLA, tiempos, proyecto, compañía y portal (`erpnext-develop/erpnext/support/doctype/issue/issue.json:9-58`, `erpnext-develop/erpnext/support/doctype/issue/issue.json:59-170`).

**Hechos Bodega.** TI ya administra tipos/activos, custodio, faena, costo, garantía, asignación única abierta, evidencia, historial append-only, mantenimiento y tickets (`db/schema/ti.ts:6-61`, `db/schema/ti.ts:63-92`, `db/schema/ti.ts:104-183`, `db/schema/ti.ts:186-215`). Feedback registra bug/consulta/sugerencia con prioridad/SLA e historial (`db/schema/feedback.ts:5-35`).

**Inferencia.** ERPNext hace mejor activos fijos contables y gestión de proyectos con costos/margen; Bodega no está atrasada en custodia TI o soporte operacional. Adoptar depreciación sólo si debe alimentar contabilidad; para proyectos, primero aclarar si contrato/faena/PDTP ya son el agregado correcto antes de crear otra dimensión transversal. Confianza alta.

### 5.22 Gobierno técnico y CI

**Hechos ERPNext.** El PR gate ejecuta pre-commit, Semgrep y reglas de corrección de tests (`erpnext-develop/.github/workflows/linters.yml:1-48`), además de CI MariaDB/Postgres y checker de docs ya citados.

**Hechos Bodega.** CI pinnea actions, alinea Node/timezone con producción, aplica gitleaks, allowlist documentada de dependencias, typecheck/lint, cobertura combinada, PGlite y Postgres real (`.github/workflows/ci.yml:23-41`, `.github/workflows/ci.yml:44-95`, `.github/workflows/ci.yml:96-260`). El contrato del repositorio exige además QA browser y reportes humanos para cambios visibles.

**Inferencia.** No hay evidencia de que ERPNext u Odoo sean globalmente “mejores” en gobierno que Bodega. ERPNext aporta Semgrep/test-correctness y matriz DB; Bodega aporta secretos, redacción, auditoría de dependencias, QA y despliegue/rollback alineado. La adopción selectiva es añadir análisis estático de reglas propias y checks de documentación, no reemplazar CI. Confianza media.

### 5.23 Colaboración y actividad ligadas al registro

**Hechos Odoo.** `mail.thread` convierte la conversación en una capacidad de cualquier modelo que la herede: seguidores, mensajes, acciones pendientes, errores de entrega y adjuntos viven junto al registro (`odoo-19.0/addons/mail/models/mail_thread.py:128-168`). El mismo contrato controla auto-suscripción, tracking, notificación al autor y envío en cola (`odoo-19.0/addons/mail/models/mail_thread.py:104-127`).

**Hechos ERPNext.** ERPNext extiende `Communication`, incluye calendario de tareas/órdenes/ToDo y aplica eventos a comunicaciones (`erpnext-develop/erpnext/hooks.py:34-59`, `erpnext-develop/erpnext/hooks.py:132-132`, `erpnext-develop/erpnext/hooks.py:411-418`). La experiencia genérica completa pertenece a Frappe y no se certifica.

**Contraste e inferencia.** Bodega tiene audit log, notificaciones navegables, eventos operacionales y comentarios específicos —por ejemplo, anomalías de combustible— (`db/schema/audit.ts:5-22`, `db/schema/audit.ts:51-105`, `db/schema/operations.ts:31-48`, `db/schema/fuel-anomalies.ts:94-117`), pero no se encontró un hilo transversal con seguidores, actividades, adjuntos y estado de entrega aplicable uniformemente a cualquier entidad. Odoo lo hace mejor: concentra contexto y responsabilidad sin inventar una bandeja por módulo. La adopción correcta sería una actividad de negocio común con políticas de visibilidad por dominio, no un chat global que exponga datos entre faenas. Confianza alta.

### 5.24 Abastecimiento y trazabilidad del proveedor

**ERPNext.** El workspace de Buying conecta Material Request, Request for Quotation, Supplier Quotation, Purchase Order y Purchase Invoice (`erpnext-develop/erpnext/buying/workspace/buying/buying.json:75-138`). Cada línea de OC conserva la cotización y línea proveedor de origen, cantidad en UOM de stock, recibido, devuelto y monto facturado (`erpnext-develop/erpnext/buying/doctype/purchase_order_item/purchase_order_item.json:500-540`, `erpnext-develop/erpnext/buying/doctype/purchase_order_item/purchase_order_item.json:599-648`). Esa continuidad permite contestar cuánto fue cotizado, ordenado, recibido, devuelto y facturado sin reconstruir el ciclo desde documentos sueltos.

**Odoo: no certificable.** El addon `purchase` base falta del snapshot; sus extensiones no bastan para afirmar el ciclo completo.

**Contraste e inferencia.** Bodega ya resolvió gran parte de solicitud → OC → recepción → DTE y adoptó política ordenado/recibido, referencias y notas de crédito. La auditoría vigente deja dos brechas precisas: asignación cuantitativa cuando una línea de factura se distribuye entre líneas de la misma OC, e impuestos/flete (`docs/compras/AUDITORIA_CONCILIADOR_2026-09-06.md:360-378`). ERPNext hace mejor la continuidad cuantitativa por línea y la etapa previa de sourcing. Prioridad alta para allocation/impuestos; RFQ/scorecard sólo si el proceso real de proveedores lo necesita. Confianza alta.

### 5.25 Gestión documental y almacenamiento desacoplado

**Hechos Odoo.** `attachment_indexation` muestra adjuntos sobre formularios e indexa ODT, PDF, XLSX y DOCX (`odoo-19.0/addons/attachment_indexation/__manifest__.py:4-18`). `cloud_storage_google` permite almacenar adjuntos del chatter en Google Cloud y declara dependencias y uninstall hook (`odoo-19.0/addons/cloud_storage_google/__manifest__.py:3-25`).

**ERPNext: parcialmente no certificable.** Los flujos inspeccionados enlazan archivos y comunicaciones, pero el gestor genérico de File/attachments pertenece principalmente a Frappe ausente.

**Contraste e inferencia.** Bodega tiene adjuntos genéricos con actor y fecha (`db/schema/audit.ts:39-49`) y almacenamiento/documentos especializados, incluido Cloudreve en SST, pero no se encontró indexación full-text común de documentos Office/PDF asociada a permisos de cada entidad. Odoo hace mejor descubrimiento documental y desacoplamiento del backend de storage. Sería útil para expedientes SST, OC/DTE y evidencia TI sólo si el índice hereda exactamente los scopes y reglas de confidencialidad del documento. Confianza media-alta.

### 5.26 Numeración configurable y consistencia multiempresa

**Hechos Odoo.** `ir.sequence` soporta prefijo, sufijo, incremento, implementación con o sin gap y subsecuencias por rango de fecha (`odoo-19.0/odoo/addons/base/models/ir_sequence.py:88-152`). El ORM puede validar automáticamente que las relaciones pertenezcan a compañías compatibles (`odoo-19.0/odoo/orm/models.py:451-453`, `odoo-19.0/odoo/orm/models.py:4003-4093`).

**Hechos ERPNext.** Purchase Order usa `naming_series` y ERPNext registra variables como año fiscal, mes, día, semana y abreviatura (`erpnext-develop/erpnext/buying/doctype/purchase_order/purchase_order.json:1-14`, `erpnext-develop/erpnext/hooks.py:463-468`). Sus documentos contables y de stock cargan `company` como dimensión explícita, aunque la garantía transversal depende de Frappe.

**Inferencia.** Ambos hacen mejor la configuración transversal de folios y, Odoo de forma verificable, la coherencia multiempresa desde el ORM. Bodega resuelve identidades y alcance por dominio/faena, lo cual es adecuado para una sociedad y operación chilena. La ventaja sólo se vuelve prioridad si aparecen múltiples razones sociales, series por faena/período o administradores que deban cambiar formatos sin deploy. Confianza alta para Odoo y media para ERPNext.

### 5.27 Amplitud funcional: ventajas reales pero condicionadas

**Ventas, CRM, e-commerce y POS.** Odoo incluye CRM con leads, oportunidades, etapas, equipos, automatización y tours (`odoo-19.0/addons/crm/__manifest__.py:5-44`), e-commerce integrado con venta, pagos, entrega y portal (`odoo-19.0/addons/website_sale/__manifest__.py:3-35`) y POS con pagos, cierre de sesión, facturación, reportes y tours (`odoo-19.0/addons/point_of_sale/__manifest__.py:4-44`). Bodega tiene clientes, contratos, propuestas y facturación, pero no persigue esa cadena comercial minorista completa.

**Manufactura.** Odoo declara órdenes de fabricación, BOM, centros/órdenes de trabajo, consumos, backorders, seriales, scrap y reabastecimiento (`odoo-19.0/addons/mrp/__manifest__.py:5-45`), aunque depende del `stock` ausente y no se certifica en runtime. ERPNext modela orden de trabajo, BOM multinivel, plan de producción, transferencia/consumo, operaciones, seriales/lotes y subcontratación (`erpnext-develop/erpnext/manufacturing/doctype/work_order/work_order.json:120-184`, `erpnext-develop/erpnext/manufacturing/doctype/work_order/work_order.json:214-303`, `erpnext-develop/erpnext/manufacturing/doctype/work_order/work_order.json:429-580`).

**Inferencia.** Ellos hacen mejor estas funciones porque son productos ERP horizontales; no son automáticamente defectos de Bodega. CRM/POS/e-commerce sólo importan si Bodega debe operar el funnel o venta directa; MRP sólo si debe planificar transformación física y costos de producción. Incorporarlos sin demanda concreta dañaría la profundidad actual en faena, EPP, SST, PDTP, flota y DTE. Confianza alta sobre presencia; prioridad condicionada a estrategia.

### 5.28 Licencias y límite de reutilización

Odoo declara LGPLv3 y advierte que componentes externos pueden tener licencias compatibles distintas (`odoo-19.0/LICENSE:2-16`). ERPNext incluye GPLv3 (`erpnext-develop/license.txt:1-11`). Bodega es un paquete privado (`package.json:1-6`). Esto no vuelve a una solución “mejor”, pero sí cambia cómo aprender de ella: los patrones, contratos e invariantes pueden estudiarse; copiar implementación requiere revisar la licencia concreta, dependencias y obligaciones de distribución con asesoría competente. Este informe recomienda adopción limpia de ideas, no traslado literal de código.

## 6. Patrones adoptables, priorizados

### P0 — Alta utilidad y frontera acotada

1. **Job ledger general.** Tabla/servicio único con `job_type`, `status`, `scheduled_at`, lease, attempts, cursor, progress, dedupe key, correlation, resultado redactado y timestamps. Migrar primero un cron no crítico y una operación masiva; conservar handlers de dominio. Evidencia inspiradora: Odoo `ir.cron` y ERPNext Bulk Transaction.
2. **Monitores de integridad de dominio.** Jobs read-only que comparen fuentes redundantes y persistan discrepancias accionables. Pruebas deterministas deben corromper un lado y demostrar detección, como Ledger Health de ERPNext.
3. **Contrato común de integración.** Interfaz profunda para configuración segura, health, capabilities, cursor, idempotencia, sync run, disable/uninstall lógico y retention. Billing Sync Run ya ofrece la base; profundizarlo evita otro framework paralelo.
4. **Registro tipado de reportes XLSX.** Definición única de permiso, scope, filtros, columnas, tipos/formato, máximo de filas, hojas y evento de auditoría. Reutilizar el builder seguro actual; no agregar CSV.

### P1 — Arquitectura que reduce costo de cambio

5. **Manifiesto de módulo profundo, incremental.** Extender sólo cuando haya consumidores reales: rutas públicas, capacidades, policies, eventos, jobs y reportes. No reactivar copias congeladas; la migración debe ser ruta por ruta y con pruebas de contrato, conforme `modules/README.md:22-31`.
6. **Kernel común de transición.** Centralizar atomicidad, current-state check, permiso, motivo, auditoría y emisión de evento. Mantener las invariantes complejas como callbacks tipados del dominio.
7. **Catálogo i18n extraíble.** Introducir claves, pluralización, formato local y chequeo CI de faltantes; partir por componentes compartidos y documentos, sin traducir masivamente strings de una vez.
8. **Ledger de upgrades.** Secuencia reanudable pre-schema → migrate → post-schema → reconcile → verify con versión de producto y compatibilidad de rollback. Drizzle sigue siendo la fuente de verdad del esquema.

### P2 — Producto y operación

9. **Onboarding y tours declarativos.** Definir pasos por rol/módulo y dispararlos sobre componentes reales; cubrirlos con Playwright. Priorizar flujos infrecuentes o de alto costo de error.
10. **Cantidad proyectada y salud del kardex.** Diferenciar on-hand, reservado, esperado y disponible, sólo si existen fuentes transaccionales confiables. Incorporar locks deterministas al procesar múltiples productos/faenas.
11. **Budget de queries.** Añadir assertions de número de consultas en servicios críticos y páginas con agregaciones, siguiendo el harness de Odoo como patrón, sin convertir cada test en un snapshot frágil.
12. **README de entrada.** Arquitectura vigente, setup, comandos, mapa de fuentes de verdad, QA, migraciones, deploy y enlaces a runbooks.
13. **Actividad por entidad.** Unificar tareas, responsables, seguidores opcionales y adjuntos bajo scopes de dominio, empezando por un flujo que hoy repita comentarios/notificaciones.
14. **Allocation e impuestos de conciliación.** Cerrar primero los dos pendientes ya demostrados del conciliador antes de ampliar sourcing o scorecards.
15. **Indexación documental gobernada.** Probar con un único tipo documental no clínico; autorización y borrado deben heredarse de la entidad fuente.

### P3 — Sólo si cambia el alcance del producto

16. **SSO/MFA corporativo, multiempresa y series administrables.** Activar por requerimiento de identidad/gobierno, no por paridad cosmética.
17. **Portales, CRM/POS/e-commerce, MRP y activos contables.** Tratar cada uno como iniciativa de producto con caso operacional, ownership y frontera contable propios; no como deuda técnica acumulada.

## 7. Decisiones que requieren producto, no sólo ingeniería

- **Contabilidad:** integrar con un ERP/contabilidad versus construir GL. No iniciar un kernel financiero sin requerimientos de período, plan de cuentas, moneda, impuestos, dimensiones, reversa y auditoría.
- **Configurabilidad:** qué puede modificar un administrador sin deploy. Cada workflow o metadato editable abre una superficie de autorización, validación, versionado y soporte.
- **Multiempresa/multipaís:** los comparados están diseñados para ello; Bodega está centrada en Chile y faena. Internacionalizar textos no implica adoptar multicompañía contable.
- **Marketplace/plugins:** un contrato interno de extensiones puede aportar valor sin aceptar addons de terceros ni su riesgo de supply chain.
- **Report builder:** selección segura de columnas/filtros versus consultas arbitrarias. Para Bodega se recomienda lo primero.

## 8. Anti-patrones a evitar

1. No recrear Frappe/Odoo dentro de Next.js como metaframework genérico antes de tener dos o más consumidores reales por abstracción.
2. No mover reglas de seguridad críticas a JSON/XML evaluable sin una capa tipada y tests de autorización.
3. No sustituir el alcance por faena ni la identidad concreta producto-variante por modelos genéricos más pobres.
4. No convertir un workflow configurable en permiso para saltar evidencia, segregación o motivos obligatorios.
5. No agregar CSV porque Odoo/ERPNext lo soporten; Bodega exige Excel.
6. No inferir que una feature de Odoo está disponible sólo porque un manifest depende de un addon ausente.
7. No afirmar garantías de Frappe —cola, versionado, exportación o UI— que no pueden verificarse en este snapshot.
8. No usar el número de addons, DocTypes o tests como sustituto de ajuste al dominio.

## 9. Metodología reproducible

1. Se leyó `AGENTS.md` completo y se respetó que `lib/` + `app/` son la implementación viva de Bodega.
2. Se inventariaron versiones, manifiestos, DocTypes, tablas, tests y presencia de componentes base con `rg`, `find` y lectura con números de línea. Se descartaron los conteos Odoo al detectar que su árbol seguía materializándose durante la inspección.
3. Para cada área se buscaron primero fuentes positivas en Odoo/ERPNext: manifiestos, modelos, metadata, tests, hooks, workflows, reportes y documentación propia.
4. Después se inspeccionaron fuentes equivalentes de Bodega sólo para descartar falsos gaps: manifests, schemas, servicios, reportes, cron, logging, CI, migraciones y runbooks.
5. Las búsquedas negativas se hicieron sobre fuentes de primera parte y se redactaron como ausencias acotadas. No se interpretaron dependencias o documentación como implementación cuando faltaba el código.
6. No se usó Internet, no se ejecutaron builds/tests/audits de producto y no se modificó código. La verificación de este trabajo se limita a integridad del Markdown, existencia de fuentes citadas y diff del único archivo de informe.

## 10. Síntesis final

Odoo 19 muestra la plataforma de extensión y metadatos más uniforme del material local; ERPNext 17-dev muestra la implementación ERP financiera y de stock más auditable; Bodega muestra mayor especialización en operación chilena, alcance por faena, trazabilidad, seguridad de exportación/logs y runbooks reales. La oportunidad no es igualar el ancho funcional de dos ERPs, sino tomar sus mecanismos que reducen costo de cambio y riesgo: contratos profundos, jobs observables, chequeos de integridad, upgrades versionados, metadata acotada, i18n y onboarding.

La única brecha que cambia materialmente el posicionamiento del producto es contabilidad general. Todas las demás pueden abordarse de forma incremental dentro de la arquitectura actual, siempre que cada nueva abstracción absorba complejidad de sus consumidores en vez de trasladarla a manifiestos más grandes.
