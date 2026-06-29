# Auditoría por Módulos — Chome Solicitudes y Bodega

## 1. Resumen ejecutivo

### Estado general
No está listo para producción sin restricciones. El build, typecheck, lint, secrets y la suite Vitest pasan, pero la verificación E2E completa no pudo arrancar por credenciales Postgres locales (`28P01`) y no hay evidencia ejecutada de rendimiento porque `perf:queries` exige una base desechable con `PERF_ALLOW_DESTRUCTIVE_RESET=true`. El sistema tiene una base funcional amplia, con RBAC server-side, scoping por faena, transacciones en compras/recepción/stock/entregas y exportaciones XLSX, pero varios módulos críticos dependen de Server Actions con cobertura baja o nula.

### Nota global
7/10.

### Recomendación final
Listo para producción con restricciones.

Restricciones mínimas: CI/E2E debe correr contra Postgres disposable real; smoke de imagen productiva debe validarse con DB accesible; los módulos con 0% de cobertura de acciones (`admin/usuarios`, `repuestos`, `servicios`, `mantenciones`) deben tener pruebas de permisos, estados y scoping antes de liberar operación amplia.

### Principales riesgos
- `npm run test:e2e` falla antes de ejecutar flujos por `password authentication failed for user "allopze"` al consultar `select count(*) from "users"`.
- `npm run perf:queries` no produce evidencia sin `PERF_ALLOW_DESTRUCTIVE_RESET=true`.
- Cobertura global aceptable pero desigual: 72.38% statements, 62.83% branches; acciones críticas quedan en 0% o bajo 50%.
- PPA público usa token aleatorio pero sin expiración observable en `db/schema/ppa.ts` y `lib/services/ppa.ts`; es defendible para consulta de resultado, pero falta política de retención/expiración del acceso público.
- Mantenciones y Flota comparten la fuente `fuel_vehicles`; hay fuente única práctica, pero flota es principalmente lectura y no cubre documentos, vencimientos, seguros ni planificación preventiva completa.

### Módulos más críticos
- Repuestos.
- Servicios.
- Mantenciones.
- Flota.
- PPA Digital.
- Analítica.

---

## 2. Resultado de comandos

| Comando | Resultado | Observación | Módulos afectados |
|---|---|---|---|
| npm run typecheck | Pasa | `tsc --noEmit` terminó con código 0. | Global |
| npm run lint | Pasa | `eslint` terminó con código 0. | Global |
| npm test | Pasa | 145 archivos passed, 4 skipped; 1504 tests passed, 4 skipped; duración 242.89s. | Global |
| npm run test:e2e | Falla | Timeout 180000ms del webServer. Error repetido: `Failed query: select count(*) from "users"`; causa `28P01 password authentication failed for user "allopze"`. | Todos los flujos UI/E2E |
| npm run test:coverage | Pasa con brechas | 72.38% statements, 62.83% branches, 78.67% functions, 73.94% lines. 145 files passed, 4 skipped. | Acciones de módulos críticos |
| npm run check:secrets | Pasa | `Env files check passed.` | Producción/seguridad |
| npm run perf:queries | No ejecuta medición | Falla por guarda: `PERF_ALLOW_DESTRUCTIVE_RESET=true is required before resetting a database for PERF.` | Reportes, dashboard, analítica, trazabilidad, listados |

Verificación adicional ejecutada: `npm run build` pasa con Next.js 16.2.9; genera rutas dinámicas para todos los módulos principales y APIs.

---

## 3. Tabla resumen por módulo

| Módulo | Estado | Nota 1-10 | Listo para producción | Riesgo | Principales problemas |
|---|---:|---:|---:|---:|---|
| Administración | Completo con brechas de cobertura | 8 | Sí, con restricciones | Medio | `admin/usuarios/actions.ts` aparece con 0% en coverage; E2E no probado localmente. |
| Solicitudes | Funcional | 7 | Sí, con restricciones | Medio | Server Action con cobertura baja; E2E bloqueado por DB local. |
| Repuestos | Parcialmente completo | 6 | No | Alto | Acciones re-exportadas con 0% en coverage; flujo real existe pero necesita E2E y pruebas server-action directas. |
| Servicios | Parcialmente completo | 6 | No | Alto | Igual que repuestos; modela servicios, pero no hay cobertura directa de actions. |
| Aprobaciones | Funcional | 7 | Sí, con restricciones | Medio | Cobertura de actions 65%; requiere prueba E2E real y carrera concurrente de aprobación en CI. |
| Compras | Funcional robusto | 8 | Sí, con restricciones | Medio | Cobertura actions 49%; eliminación dura de OC requiere vigilancia operativa. |
| Recepción | Sólido | 8 | Sí, con restricciones | Medio | Buen control oficina/faena; depende de E2E real para prueba punta a punta. |
| Bodega / Stock | Sólido | 8 | Sí, con restricciones | Medio | Mutación centralizada y transaccional; actions 53% coverage. |
| Entregas | Sólido | 8 | Sí, con restricciones | Medio | Buen control de stock y trabajador; faltan firmas/comprobantes avanzados. |
| Trazabilidad | Bueno | 8 | Sí, con restricciones | Medio | Export y detalle existen; no cubre todos los eventos periféricos como devoluciones/ajustes en narrativa completa. |
| Reportes | Bueno | 7 | Sí, con restricciones | Medio | XLSX y filtros existen; prueba perf no ejecutada. |
| Analítica | Bueno pero sensible a rendimiento | 7 | Sí, con restricciones | Medio | Muchas agregaciones; falta evidencia `perf:queries`. |
| Evaluaciones SST | Funcional amplio | 7 | Sí, con restricciones | Medio | Cobertura del servicio decente, pero actions 25.82%; campo/UX debe validarse en terreno. |
| PPA Digital | Funcional con riesgo público | 7 | Sí, con restricciones | Alto | Ruta pública rate-limited, pero token de resultado sin expiración observable. |
| Combustibles | Funcional reciente | 7 | Sí, con restricciones | Medio | Buenas validaciones; actions 30.74%; import API no cubre todos los casos con DB real. |
| Flota | Vista consolidada mínima | 5 | No | Alto | Solo lectura; faltan documentos, vencimientos, responsable, seguros y CRUD propio. |
| Mantenciones | Parcial | 5 | No | Alto | CRUD básico; actions 0%; sin auditoría observable en servicio. |
| Soporte / Feedback | Funcional | 8 | Sí, con restricciones | Bajo | Buen CRUD de tickets; faltan adjuntos/notificaciones más ricas. |

---

## 4. Auditoría detallada por módulo

### 4.1 Administración

#### Propósito funcional esperado
Administrar usuarios, roles, permisos, faenas, proveedores, productos, trabajadores, configuración, correo, plantillas y auditoría.

#### Implementación encontrada
Rutas en `app/(app)/admin/**`; Server Actions por submódulo; schemas en `lib/validation/masters.ts`; RBAC en `lib/auth/*`; tablas `users`, `roles`, `permissions`, `worksite_users`, `worksites`, `suppliers`, `workers`, `products`, `system_settings`, `email_templates`, `audit_log`.

#### Flujo real detectado
Cada subruta exige permisos `admin:*`; usuarios e invitaciones se gestionan con transacciones; faenas/proveedores/productos/trabajadores registran auditoría; SMTP y configuración usan servicios.

#### Permisos y seguridad
Server-side con `requirePermission`; administración de usuarios usa `canManageUserInAdminScope`, validación de faenas y restricción de rol administrador.

#### Base de datos y persistencia
Modelo suficiente para RBAC híbrido y faenas. Seed deriva permisos desde sistema/manifests y rechaza contraseña default en producción.

#### Validaciones
Zod en masters y validaciones server-side. Correcto.

#### Lógica de negocio
Invitaciones, roles directos, permisos directos y faenas se escriben transaccionalmente.

#### Integraciones con otros módulos
Es base de RBAC, catálogos y usuarios para todo el sistema.

#### UI/UX
Panel administrativo por submódulos; navegación coherente desde `/admin`.

#### Tests
Existen tests de admin, scope, productos, trabajadores y RBAC. Brecha: coverage muestra `app/(app)/admin/usuarios/actions.ts` en 0%.

#### Rendimiento
Riesgo bajo; listados admin acotados, pero usuarios/faenas deben paginarse si crecen.

#### Bugs encontrados
- `app/(app)/admin/usuarios/actions.ts`: 0% en reporte de cobertura; no demuestra por coverage las mutaciones más sensibles de RBAC.

#### Funcionalidades faltantes indispensables
Auditoría visible de configuración SMTP/plantillas con diff completo; paginación/búsqueda robusta para catálogos grandes.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones de pruebas E2E y cobertura de usuarios/permisos.

#### Acciones recomendadas
Agregar tests directos para `inviteUser`, `createUser`, `updateUser`, `toggleUserActive`; ejecutar E2E admin en CI/local con DB disposable válida.

---

### 4.2 Solicitudes de EPP

#### Propósito funcional esperado
Crear, guardar, enviar y consultar solicitudes EPP/otros con ítems, productos, atributos, adjuntos y flujo a aprobación.

#### Implementación encontrada
`app/(app)/solicitudes/**`, `app/(app)/solicitudes/actions.ts`, `lib/services/requests-draft.ts`, `lib/services/requests-delete.ts`, `lib/services/item-state.ts`, `lib/validation/operations.ts`, `db/schema/requests.ts`.

#### Flujo real detectado
Creación y edición de borradores, envío a estado solicitado, detalle por ID, borrado restringido y conexión a aprobaciones/compras por estado de ítem.

#### Permisos y seguridad
Usa `requests:create`, `requests:view_own`, `requests:view_all`, `requests:submit`, `requests:delete`; revisa ownership y faena en servidor.

#### Base de datos y persistencia
`purchase_requests`, `purchase_request_items`, atributos, decisiones y status history. Diseño centrado en ítem.

#### Validaciones
Zod exige faena, fecha, ítems y cantidades positivas.

#### Lógica de negocio
Transiciones centralizadas en `item-state.ts`. Buen diseño.

#### Integraciones con otros módulos
Aprobaciones, compras, recepción, trazabilidad, reportes.

#### UI/UX
Lista, formulario, picker de producto, detalle y duplicación. Suficiente.

#### Tests
Tests de request-actions, draft diff, delete, submit, full-flow. Coverage de `app/(app)/solicitudes/actions.ts` 36.61%.

#### Rendimiento
Listados usan consultas con filtros; riesgo medio si crecen sin paginación real en todas las vistas.

#### Bugs encontrados
- `app/(app)/solicitudes/actions.ts`: cobertura baja en mutaciones críticas; no hay E2E ejecutado por fallo de DB.

#### Funcionalidades faltantes indispensables
Evidencia E2E verde del flujo solicitud -> aprobación -> compra.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Subir cobertura de Server Actions y reparar entorno E2E.

---

### 4.3 Repuestos

#### Propósito funcional esperado
Solicitud propia de repuestos, con equipo/patente/parte, cotizaciones y aprobación.

#### Implementación encontrada
`app/(app)/repuestos/**`, `lib/services/repuestos.ts`, `lib/requests/request-service.ts`, `lib/validation/repuestos.ts`, `db/schema/repuestos.ts`, manifest `modules/repuestos/manifest.ts`.

#### Flujo real detectado
Usa factory compartido para borrador, envío, carga de PDF, eliminación, selección de cotización y cancelación. Guarda ítems libres con atributos de repuesto.

#### Permisos y seguridad
Permisos independientes `repuestos:*`; actions exigen permiso server-side y scoping por faena.

#### Base de datos y persistencia
Reutiliza `purchase_requests` con `requestType="repuestos"` y tabla `repuesto_quotations`.

#### Validaciones
Zod cubre descripción, cantidad, unidad, parte, equipo, patente, marca, modelo y cotizaciones PDF.

#### Lógica de negocio
Requiere 3 cotizaciones salvo justificación; selección aprueba ítems y los deja disponibles para compra.

#### Integraciones con otros módulos
Se integra con compras por ítems aprobados; no aparece en sidebar (`nav: []`) aunque existe ruta.

#### UI/UX
Formulario propio y detalle con panel de cotizaciones. Falta discoverability en navegación principal.

#### Tests
Hay tests de factory, validación y permisos; coverage reporta `app/(app)/repuestos/actions.ts` en 0%.

#### Rendimiento
Riesgo bajo/medio; usa queries directas y reutiliza flujo de solicitudes.

#### Bugs encontrados
- `modules/repuestos/manifest.ts`: `nav: []`; módulo registrado pero no visible por navegación principal.
- `app/(app)/repuestos/actions.ts`: 0% coverage del wrapper de actions.

#### Funcionalidades faltantes indispensables
E2E real de solicitud de repuesto con cotización seleccionada y OC.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No para uso amplio.

#### Acciones recomendadas
Agregar nav o acceso claro; tests Server Action directos; E2E repuestos -> compras.

---

### 4.4 Servicios

#### Propósito funcional esperado
Solicitar servicios externos con ubicación, equipo, cotizaciones y aprobación.

#### Implementación encontrada
`app/(app)/servicios/**`, `lib/services/servicios.ts`, `lib/requests/request-service.ts`, `lib/validation/servicios.ts`, `db/schema/servicios.ts`.

#### Flujo real detectado
Factory compartido con repuestos, pero validación y atributos propios: ubicación obligatoria, equipo, patente, marca y modelo.

#### Permisos y seguridad
Permisos `servicios:*`; scoping por faena y ownership en servidor.

#### Base de datos y persistencia
`purchase_requests.requestType="servicios"` y `service_quotations`.

#### Validaciones
Zod fuerte para descripción, ubicación y cotizaciones.

#### Lógica de negocio
Tres cotizaciones salvo justificación; selección aprueba ítems.

#### Integraciones con otros módulos
Compra ítems aprobados. No genera stock por sí mismo; correcto para servicios.

#### UI/UX
Formulario y detalle propios; `nav: []` reduce descubribilidad.

#### Tests
Tests de validation y factory; `app/(app)/servicios/actions.ts` aparece 0%.

#### Rendimiento
Riesgo bajo/medio.

#### Bugs encontrados
- `modules/servicios/manifest.ts`: `nav: []`, módulo registrado pero no navegable desde sidebar.
- `app/(app)/servicios/actions.ts`: 0% coverage.

#### Funcionalidades faltantes indispensables
E2E de servicio externo aprobado y convertido en compra.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No para uso amplio.

#### Acciones recomendadas
Agregar navegación si el módulo será usado; cubrir actions y flujo con E2E.

---

### 4.5 Aprobaciones

#### Propósito funcional esperado
Cola de ítems pendientes, aprobación/rechazo, contador y transición hacia compras.

#### Implementación encontrada
`app/(app)/aprobaciones/page.tsx`, `actions.ts`, `lib/services/item-state.ts`, `lib/work-queue.ts`, `approval_decisions`.

#### Flujo real detectado
Cola filtrada por faena, aprobación/rechazo por ítem y registro de auditoría/status.

#### Permisos y seguridad
`approvals:approve` server-side y `canAccessWorksite`.

#### Base de datos y persistencia
`approval_decisions` y `status_history` registran decisiones.

#### Validaciones
Motivos y estado son validados por actions/servicio.

#### Lógica de negocio
Transiciones controladas por `item-state.ts`; evita aprobar estados no válidos.

#### Integraciones con otros módulos
Compra consume ítems `approved` o `pending_purchase`.

#### UI/UX
Panel de aprobación y badge de pendientes.

#### Tests
Tests de `aprobaciones-actions` e `item-state`; coverage actions 65%.

#### Rendimiento
Riesgo medio en cola si crece sin paginación.

#### Bugs encontrados
- Sin fallo lógico confirmado; falta E2E ejecutado por el bloqueo de DB.

#### Funcionalidades faltantes indispensables
Prueba concurrente de doble aprobación a nivel E2E/DB real.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Cubrir carrera de aprobación y validar badge con datos reales.

---

### 4.6 Compras / Órdenes de Compra

#### Propósito funcional esperado
Crear OC desde aprobados, emitir, enviar, adjuntar facturas, imprimir, cancelar/eliminar si corresponde e integrarse con recepción.

#### Implementación encontrada
`app/(app)/compras/**`, `lib/services/purchasing.ts`, `lib/order-totals.ts`, `app/(print)/compras/[id]/print`, API de factura, schema `db/schema/purchasing.ts`.

#### Flujo real detectado
Crea OCs por proveedor, evita ítems duplicados, valida faena, emite y envía con transición de ítems a `purchased`, adjunta factura validada por magic bytes.

#### Permisos y seguridad
`purchasing:view`, `create_order`, `send_order`, `delete_order`; scoping por faena en actions y servicios.

#### Base de datos y persistencia
`purchase_orders`, `purchase_order_items`, `purchase_order_invoices`, `quotations`.

#### Validaciones
Zod para OC/facturas; totales por `computeOrderTotals`.

#### Lógica de negocio
Transaccional. Divide OCs por proveedor. No permite enviar OC vacía.

#### Integraciones con otros módulos
Aprobaciones -> compras -> recepción; impresión y facturas.

#### UI/UX
Lista, detalle, nueva OC, CTA a recepción, print.

#### Tests
Tests de create/cancel/order totals/purchasing service; coverage `app/(app)/compras/actions.ts` 49.04%.

#### Rendimiento
Riesgo medio en listados y detalle con muchas facturas/ítems.

#### Bugs encontrados
- No se confirmó bug funcional. La brecha es cobertura insuficiente de actions críticas y E2E bloqueado.

#### Funcionalidades faltantes indispensables
Evidencia de envío real por email; conciliación contable avanzada queda fuera.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Pruebas directas de `sendOrderAction`, `deleteOrderAction`, facturas y print/PDF.

---

### 4.7 Recepción

#### Propósito funcional esperado
Recepción en oficina y faena, parcial, sin stock en oficina y con stock en faena.

#### Implementación encontrada
`app/(app)/recepcion/**`, `lib/services/receiving.ts`, `lib/services/stock.ts`, `db/schema/receiving.ts`.

#### Flujo real detectado
Obliga llegada a oficina antes de faena; bloquea recibir más que lo pendiente; solo la etapa faena aplica `ingreso_oc`.

#### Permisos y seguridad
`receiving:view`, `register_office`, `register_faena`; scoping por faena.

#### Base de datos y persistencia
`receipts`, `receipt_items`, cantidades `quantityOfficeReceived` y `quantityReceived` en OC item.

#### Validaciones
Zod para recepción; servicio valida duplicados, cantidades y estado de OC.

#### Lógica de negocio
Transacción con `for update`; rollup de estados de OC determinístico.

#### Integraciones con otros módulos
Compra, stock, trazabilidad.

#### UI/UX
Lista, detalle y formulario de recepción.

#### Tests
`receiving-service`, `receiving-two-stage`, `register-receipt-action`, concurrencia Postgres.

#### Rendimiento
Riesgo bajo/medio.

#### Bugs encontrados
- Sin bug funcional confirmado.

#### Funcionalidades faltantes indispensables
E2E verde del flujo OC -> oficina -> faena.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Reparar entorno E2E y ejecutar `purchase-flow.spec.ts`.

---

### 4.8 Bodega / Stock

#### Propósito funcional esperado
Stock actual, kardex, ajustes, devoluciones y exportación XLSX.

#### Implementación encontrada
`app/(app)/bodega/**`, APIs `/api/bodega/stock/export`, `/api/bodega/kardex/export`, `lib/services/stock.ts`, `db/schema/stock.ts`.

#### Flujo real detectado
`applyMovement` es el único punto de mutación; upsert transaccional; bloquea stock negativo; registra `inventory_movements`.

#### Permisos y seguridad
`warehouse:view_stock`, `register_movement`, `adjust_stock`; scoping por faena en páginas, actions y export.

#### Base de datos y persistencia
`worksite_stock` con unique worksite/product y `inventory_movements` con índices por faena/producto/fecha.

#### Validaciones
Zod para despacho, entrega trabajador, ajuste, devolución y mínimo.

#### Lógica de negocio
Buena. Ajuste exige motivo; egresos no dejan negativo.

#### Integraciones con otros módulos
Recepción suma stock; entregas descuentan; reportes y trazabilidad leen.

#### UI/UX
Stock table, kardex, paneles de ajuste/devolución y export buttons.

#### Tests
`stock-service`, `stock-concurrency-postgres`, `stock-export`, `bodega-actions`; coverage actions 53.46%.

#### Rendimiento
Exports limitados a 10.000 filas.

#### Bugs encontrados
- No confirmado. Riesgo de cobertura baja en actions.

#### Funcionalidades faltantes indispensables
Conteo físico/cierre de inventario formal si se usará como bodega productiva completa.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Completar tests de actions de ajuste/devolución y ejecutar perf.

---

### 4.9 Entregas

#### Propósito funcional esperado
Entrega EPP a trabajador, descuento de stock, historial y cierre operativo.

#### Implementación encontrada
`app/(app)/entregas/**`, `lib/services/deliveries.ts`, attachments en `db/schema/audit.ts`, stock y item-state.

#### Flujo real detectado
Entrega a faena o trabajador; para trabajador valida producto EPP, trabajador activo, faena, stock y saldo pendiente; descuenta stock y actualiza estado.

#### Permisos y seguridad
`deliveries:view`, `deliveries:create`; scoping por faena.

#### Base de datos y persistencia
`deliveries`, `delivery_items`, attachments opcionales y `inventory_movements`.

#### Validaciones
Zod para entrega, cantidad y devolución.

#### Lógica de negocio
Transaccional, con locks por request item.

#### Integraciones con otros módulos
Bodega, trazabilidad, trabajadores, solicitudes.

#### UI/UX
Pantalla operativa con trabajadores, stock y entregas.

#### Tests
Tests de servicio, actions, concurrencia Postgres y E2E worker delivery declarado.

#### Rendimiento
Riesgo medio en historial si crece; requiere paginación sostenida.

#### Bugs encontrados
- Sin bug funcional confirmado.

#### Funcionalidades faltantes indispensables
Firma digital/comprobante formal de recepción por trabajador.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Validar adjuntos/firma en E2E y perf de historial.

---

### 4.10 Trazabilidad

#### Propósito funcional esperado
Matriz y detalle por ítem desde solicitud hasta entrega, exportación XLSX.

#### Implementación encontrada
`app/(app)/trazabilidad/**`, API `/api/trazabilidad/export`, `lib/services/trazabilidad-export.ts`, `lib/services/trazabilidad-item.ts`.

#### Flujo real detectado
Deriva datos de solicitudes visibles, OCs, recepciones, entregas y status history.

#### Permisos y seguridad
Página usa `traceability:view`; export API usa `reports:view`, inconsistente con el manifest de trazabilidad.

#### Base de datos y persistencia
Lee tablas operacionales; no inventa eventos.

#### Validaciones
Filtros por fecha/faena y límite export.

#### Lógica de negocio
Buena para flujo principal; casos de ajustes/devoluciones no aparecen como timeline completo de auditoría.

#### Integraciones con otros módulos
Solicitudes, aprobaciones, compras, recepción, bodega, entregas.

#### UI/UX
Matriz y detalle navegable.

#### Tests
`trazabilidad-export`, `trazabilidad-export-scope`, `trazabilidad-item`.

#### Rendimiento
Export limitado; `perf:queries` no ejecutado.

#### Bugs encontrados
- `app/api/trazabilidad/export/route.ts` protege con `reports:view` mientras el módulo declara `traceability:view`; puede impedir exportar a usuarios que ven trazabilidad pero no reportes.

#### Funcionalidades faltantes indispensables
Timeline que incluya explícitamente ajustes, devoluciones y desechos.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Alinear permiso de exportación con `traceability:view` o documentar que depende de reportes.

---

### 4.11 Reportes

#### Propósito funcional esperado
Reportes operacionales y exportación XLSX.

#### Implementación encontrada
`app/(app)/reportes/page.tsx`, `/api/reportes/export`, `lib/reports/export.ts`.

#### Flujo real detectado
Exporta gasto por faena, ítems sin OC, OC por estado, solicitudes, compras, recepción y analítica.

#### Permisos y seguridad
`reports:view` y permisos equivalentes para listas; scoping por faena en consultas.

#### Base de datos y persistencia
Agregaciones sobre tablas reales.

#### Validaciones
Filtros por fecha/faena/proveedor/estado; límite 10.000 filas.

#### Lógica de negocio
Correcta para reportes principales.

#### Integraciones con otros módulos
Compra, solicitudes, recepción, analítica.

#### UI/UX
Pantalla de reportes y export XLSX.

#### Tests
`report-export`, `report-export-route`.

#### Rendimiento
Sin evidencia `perf:queries`; riesgo medio con muchos registros.

#### Bugs encontrados
- Sin bug confirmado.

#### Funcionalidades faltantes indispensables
Plantillas contables avanzadas y conciliación de facturas si se requiere operación financiera.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Ejecutar perf en DB disposable y fijar SLO de export.

---

### 4.12 Analítica

#### Propósito funcional esperado
KPIs, tendencias, distribuciones, filtros y export.

#### Implementación encontrada
`app/(app)/analitica/**`, `lib/services/analytics.ts`, export `analitica_resumen` en reportes.

#### Flujo real detectado
Calcula gasto total, variaciones, OC, aprobaciones pendientes, stock crítico, combustible, proveedores, faenas, vehículos, EPP, alertas y brechas.

#### Permisos y seguridad
`analytics:view`; export permite `analytics:export` o `analytics:view`.

#### Base de datos y persistencia
Agregaciones cruzadas sobre compras, combustible, stock y entregas.

#### Validaciones
Normalización de filtros en servicio.

#### Lógica de negocio
Útil, pero requiere definiciones de KPI firmes para evitar interpretaciones operativas erróneas.

#### Integraciones con otros módulos
Todo el sistema operacional.

#### UI/UX
Gráficos Recharts y filtros.

#### Tests
`analytics-service.test.ts`; cobertura servicio 94.53%.

#### Rendimiento
Alto riesgo relativo por agregaciones cruzadas; `perf:queries` no se ejecutó.

#### Bugs encontrados
- Sin bug confirmado.

#### Funcionalidades faltantes indispensables
Glosario de KPI visible o documentado y umbrales operativos.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Correr `perf:queries` en DB disposable y fijar umbrales por consulta.

---

### 4.13 Evaluaciones SST

#### Propósito funcional esperado
Evaluaciones SST con checklist, rol evaluador, plan de acción, cierre, cumplimiento, PDF y alertas.

#### Implementación encontrada
`app/(app)/prevencion/**`, `lib/services/sst.ts`, `lib/sst/**`, `lib/validation/sst.ts`, cron `/api/cron/sst-weekly-alerts`, print `/sst/[id]/print`.

#### Flujo real detectado
Crea evaluación, guarda respuestas, followups, plan de acción, cierra con cálculo y alerta semanal.

#### Permisos y seguridad
`sst:view`, `create`, `close`, `manage`, `evaluate_acompanamiento`; scoping por faena.

#### Base de datos y persistencia
`sst_evaluations`, responses, followups, action plan, weekly evaluations.

#### Validaciones
Schemas y helpers de compliance; cierre valida completitud.

#### Lógica de negocio
Amplia y mayormente centralizada.

#### Integraciones con otros módulos
Trabajadores/faenas, notificaciones, PDF/print.

#### UI/UX
Lista, detalle, checklist, action plan, followups, vista trabajador.

#### Tests
Muchos tests SST; coverage `lib/services/sst.ts` 72.67%, pero `app/(app)/prevencion/actions.ts` 25.82%.

#### Rendimiento
Riesgo medio en listados agrupados por trabajador.

#### Bugs encontrados
- `app/(app)/prevencion/actions.ts` coverage bajo para actions críticas de terreno.

#### Funcionalidades faltantes indispensables
Validación con usuarios de terreno y offline/degradación si se usa en mala conexión.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Cubrir actions y flujo PDF con E2E estable.

---

### 4.14 PPA Digital

#### Propósito funcional esperado
Formulario público vía QR/token, evaluación automática, revisión supervisor, dashboard y export.

#### Implementación encontrada
`app/(public)/ppa/**`, `app/(app)/prevencion/ppa/**`, `lib/services/ppa.ts`, `lib/validation/ppa.ts`, `lib/ppa/evaluation.ts`, API export.

#### Flujo real detectado
Formulario público identifica trabajador por RUT o manual, evalúa y crea token público; detenidos notifican revisores; panel interno revisa/cierra.

#### Permisos y seguridad
Público sin login con Zod y rate limit; interno con `ppa:view`, `ppa:review`, `ppa:manage` y faena scope.

#### Base de datos y persistencia
`ppa_submissions` almacena respuestas JSON, resultado, estado, public token y revisión.

#### Validaciones
Zod y evaluación pura; RUT validado para lookup.

#### Lógica de negocio
Estados `aprobado_auto`, `detenido`, `en_correccion`, `autorizado`, `rechazado`, `cerrado`.

#### Integraciones con otros módulos
Prevención, trabajadores, notificaciones, reportes.

#### UI/UX
Formulario público simple y panel interno.

#### Tests
PPA actions/service/stats/evaluation. Coverage buena en actions públicas; `lib/services/ppa.ts` 22.75% por muchas ramas sin cubrir.

#### Rendimiento
Listados paginados; export sin límite explícito observado en route.

#### Bugs encontrados
- `db/schema/ppa.ts` y `lib/services/ppa.ts`: `publicToken` permite consultar resultado sin expiración observable. Riesgo de privacidad si un enlace se filtra.

#### Funcionalidades faltantes indispensables
TTL/rotación de token público o política de retención; modo offline/de conexión mala.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Agregar expiración o invalidación de token y límites de exportación.

---

### 4.15 Combustibles

#### Propósito funcional esperado
CRUD de cargas, importación Excel, vehículos, proveedores, cuenta corriente, reportes, KPIs, filtros y export XLSX.

#### Implementación encontrada
`app/(app)/combustibles/**`, `app/api/combustibles/import/route.ts`, `lib/combustibles/**`, schemas `fuel_*`.

#### Flujo real detectado
Registro individual, import JSON ya parseado desde Excel en UI, validación de totales, deduplicación, catálogos, cuenta corriente y pagos.

#### Permisos y seguridad
`combustibles:*`; import y actions validan permiso y faena.

#### Base de datos y persistencia
`fuel_loads`, `fuel_vehicles`, `fuel_suppliers`, `fuel_monthly_statements`, `fuel_payments`.

#### Validaciones
Zod para cargas, vehículos, proveedores, statements y pagos; cálculo tributario en `lib/combustibles/calculations.ts`.

#### Lógica de negocio
Transacciones para import, cuenta corriente y pagos; bloquea edición de cargas conciliadas/asignadas.

#### Integraciones con otros módulos
Flota y analítica.

#### UI/UX
Listados, filtros, gráficos, import modal, reportes y subcatálogos.

#### Tests
Tests de cálculos/import/reportes/vehículos/actions; coverage `app/(app)/combustibles/actions.ts` 30.74%.

#### Rendimiento
Falta evidencia perf. Export de combustibles no muestra límite de filas como reportes generales.

#### Bugs encontrados
- `app/(app)/combustibles/actions.ts`: cobertura baja en muchas mutaciones.
- `exportFuelLoadsXlsxAction`: exporta todas las filas filtradas sin límite visible; riesgo con mucho volumen.

#### Funcionalidades faltantes indispensables
Prueba de importación con archivo Excel real extremo y límite de export.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Subir tests de actions, agregar límite/paginación al export, ejecutar perf.

---

### 4.16 Flota

#### Propósito funcional esperado
Vista consolidada y catálogo completo de vehículos con documentos, vencimientos, responsable e integración.

#### Implementación encontrada
`app/(app)/flota/page.tsx`, `lib/services/fleet.ts`, datos desde `fuel_vehicles`, `fuel_loads`, `maintenance_records`.

#### Flujo real detectado
Vista de costos por vehículo, litros, cargas, mantenciones y faena.

#### Permisos y seguridad
`flota:view`; scoping por faena en servicio.

#### Base de datos y persistencia
No tiene tabla propia: usa `fuel_vehicles` como fuente única práctica.

#### Validaciones
No aplica a CRUD porque es lectura.

#### Lógica de negocio
Agregación simple y útil, pero no controla ciclo de vida documental.

#### Integraciones con otros módulos
Combustibles y mantenciones.

#### UI/UX
Vista consolidada, no gestión integral.

#### Tests
`fleet-service.test.ts`.

#### Rendimiento
Agrupa por vehículo; riesgo medio si crecen cargas y mantenciones sin índices suficientes.

#### Bugs encontrados
- Módulo esperado como flota empresarial, pero implementación real es vista consolidada mínima.

#### Funcionalidades faltantes indispensables
CRUD/estado operacional, responsable, documentación, revisión técnica, permisos, seguros, vencimientos y alertas.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
5/10.

#### ¿Listo para producción?
No como módulo de flota completo.

#### Acciones recomendadas
Definir si flota será solo lectura o dueño del catálogo; agregar documentos/vencimientos o documentar alcance limitado.

---

### 4.17 Mantenciones

#### Propósito funcional esperado
Lista, historial, filtros, crear, editar/cancelar, preventivas y correctivas.

#### Implementación encontrada
`app/(app)/mantenciones/**`, `lib/services/maintenance.ts`, `lib/validation/maintenance.ts`, `db/schema/maintenance.ts`.

#### Flujo real detectado
Crea, actualiza y cancela registros vinculados a `fuel_vehicles`; valida montos neto+IVA=total y faena.

#### Permisos y seguridad
`mantenciones:view`, `create`, `edit`; scoping por faena en servicio.

#### Base de datos y persistencia
`maintenance_records` con vehículo, proveedor, faena, centro de costo, fechas, odómetro, horómetro y montos.

#### Validaciones
Zod de montos, estado, vehículo y fecha.

#### Lógica de negocio
CRUD básico; no hay planificación preventiva ni vencimientos próximos.

#### Integraciones con otros módulos
Flota y analítica.

#### UI/UX
Listado y formulario.

#### Tests
`maintenance-service` y `maintenance-validation`; coverage de `app/(app)/mantenciones/actions.ts` 0%.

#### Rendimiento
Limit 100 en page data; adecuado como inicio, pero no paginación real.

#### Bugs encontrados
- `lib/services/maintenance.ts`: create/update/cancel no registran `recordAudit`.
- `app/(app)/mantenciones/actions.ts`: 0% coverage.

#### Funcionalidades faltantes indispensables
Plan preventivo, alertas, documentación, auditoría de cambios, historial de ediciones.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
5/10.

#### ¿Listo para producción?
No.

#### Acciones recomendadas
Agregar auditoría, tests de actions y modelo de planificación preventiva.

---

### 4.18 Soporte / Feedback

#### Propósito funcional esperado
Crear reportes, ver propios/todos, gestionar estados y notas internas.

#### Implementación encontrada
`app/(app)/soporte/**`, `lib/services/feedback.ts`, `lib/validation/feedback.ts`, `db/schema/feedback.ts`.

#### Flujo real detectado
Usuario crea bug/consulta/sugerencia; gestores ven todos y cambian estado con nota interna.

#### Permisos y seguridad
`feedback:create`, `view_own`, `view_all`, `manage`; detalle protege own/all y notas internas dependen de manage.

#### Base de datos y persistencia
`feedback_reports` con tipo, estado, prioridad implícita limitada, nota interna, timestamps.

#### Validaciones
Zod para creación y estado.

#### Lógica de negocio
Suficiente para buzón gestionable.

#### Integraciones con otros módulos
Usuarios y navegación de soporte; tests de notificaciones.

#### UI/UX
Crear reporte, lista, detalle y panel de estado.

#### Tests
`feedback.test.ts`, `soporte-notificaciones.test.ts`; coverage actions 96.55%.

#### Rendimiento
Riesgo bajo.

#### Bugs encontrados
- Sin bug funcional confirmado.

#### Funcionalidades faltantes indispensables
Adjuntos, prioridad explícita, SLA/notificaciones por estado.

#### Severidad de hallazgos
Bajo.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones menores.

#### Acciones recomendadas
Agregar prioridad/SLA si soporte será canal formal.

---

## 5. Hallazgos críticos globales

- Título: E2E local no ejecutable con entorno actual.
  Severidad: Alto.
  Módulos afectados: Todos.
  Evidencia técnica: `npm run test:e2e` termina en timeout webServer 180000ms; error `select count(*) from "users"` con `28P01 password authentication failed for user "allopze"`.
  Riesgo operativo: no hay prueba browser real de flujos críticos en esta auditoría.
  Recomendación concreta: ejecutar con `E2E_DATABASE_URL` válido o preparar `postgres:///bodega_e2e` por socket según `docs/pruebas/TESTING.md`.

- Título: Performance no medido.
  Severidad: Medio.
  Módulos afectados: Reportes, Analítica, Dashboard, Trazabilidad, Combustibles.
  Evidencia técnica: `npm run perf:queries` aborta por falta de `PERF_ALLOW_DESTRUCTIVE_RESET=true`.
  Riesgo operativo: no hay latencia ni plan de consultas contra volumen.
  Recomendación concreta: correr en DB disposable con flag explícito y archivar resultados.

- Título: Cobertura desigual en Server Actions críticas.
  Severidad: Alto.
  Módulos afectados: Admin usuarios, Repuestos, Servicios, Mantenciones, Combustibles, Solicitudes, Compras, Prevención.
  Evidencia técnica: coverage reporta 0% en `app/(app)/admin/usuarios/actions.ts`, `app/(app)/repuestos/actions.ts`, `app/(app)/servicios/actions.ts`, `app/(app)/mantenciones/actions.ts`; 30.74% en combustibles, 36.61% solicitudes, 49.04% compras.
  Riesgo operativo: permisos y transiciones pueden romperse sin que CI lo detecte.
  Recomendación concreta: tests directos de Server Actions con sesiones scoped/globales y estados inválidos.

- Título: Permiso de export de trazabilidad no coincide con manifest.
  Severidad: Medio.
  Módulos afectados: Trazabilidad, Reportes.
  Evidencia técnica: `/api/trazabilidad/export` exige `reports:view`; manifest declara `traceability:view`.
  Riesgo operativo: usuarios con permiso de trazabilidad pueden no exportar lo que ven.
  Recomendación concreta: alinear permiso o documentar explícitamente dependencia de reportes.

- Título: PPA público sin expiración de token observable.
  Severidad: Alto.
  Módulos afectados: PPA Digital, Prevención.
  Evidencia técnica: `ppa_submissions.publicToken` y `getPpaByToken(token)` consultan resultado público sin TTL visible.
  Riesgo operativo: enlace filtrado expone resultado/identificación por tiempo indefinido.
  Recomendación concreta: agregar expiración, rotación o vista pública de datos mínimos.

---

## 6. Funcionalidades indispensables faltantes

- Seguridad: E2E reproducible con DB disposable, expiración de tokens públicos PPA, cobertura de actions críticas.
- Administración: cobertura completa de usuarios/permisos y auditoría detallada de configuración.
- Compras: prueba real de email/PDF y conciliación contable avanzada si será alcance productivo.
- Bodega: conteo físico/cierre de inventario y comprobantes firmados.
- Prevención: validación de terreno, modo degradado/offline para PPA/SST si se usará en faena.
- Vehículos: documentación, vencimientos, seguros, responsable y estado operacional.
- Reportes: evidencia perf y límites consistentes en todos los exports.
- UX: navegación visible para Repuestos/Servicios si serán módulos operativos.
- Operación: smoke E2E y smoke Docker contra DB accesible.
- Producción: runbook de ejecución de perf/E2E y SLO de consultas.

---

## 7. Riesgos de producción

- Riesgos críticos: ninguno confirmado en lógica de stock/recepción/compras durante esta auditoría.
- Riesgos altos: E2E no ejecutado por entorno; PPA token público sin expiración; mantenciones incompleto; repuestos/servicios sin cobertura actions y sin navegación.
- Riesgos medios: performance sin medir; coverage desigual; export trazabilidad con permiso cruzado; flota limitada.
- Riesgos bajos: soporte sin adjuntos/SLA; reportes contables avanzados fuera de alcance actual.

---

## 8. Plan de corrección recomendado

### Prioridad 1 — Bloqueante para producción
- Reparar ejecución local/CI de `npm run test:e2e` con `E2E_DATABASE_URL` válido y DB desechable.
- Agregar tests de Server Actions para `admin/usuarios`, `repuestos`, `servicios`, `mantenciones`.
- Definir y aplicar expiración/retención para `ppa_submissions.publicToken`.

### Prioridad 2 — Alta
- Agregar auditoría a create/update/cancel de mantenciones.
- Alinear permiso de `/api/trazabilidad/export`.
- Añadir navegación o punto de entrada explícito para Repuestos y Servicios.
- Ejecutar `perf:queries` con `PERF_ALLOW_DESTRUCTIVE_RESET=true` contra base disposable.

### Prioridad 3 — Media
- Subir coverage de combustibles, solicitudes, compras, bodega y prevención actions.
- Limitar export de combustibles igual que reportes/stock/kardex.
- Completar flota con documentación, vencimientos y responsable.

### Prioridad 4 — Baja
- Adjuntos y SLA en soporte.
- Glosario visible de KPIs de analítica.
- Mejoras UX de terreno para PPA/SST.

---

## 9. Veredicto final

- ¿Está listo para producción? No para despliegue amplio sin restricciones. Sí podría ir a marcha blanca controlada si se limita el alcance, se respalda la DB y se ejecutan E2E/perf en ambiente válido.
- ¿Qué nota global obtiene del 1 al 10? 7/10.
- ¿Cuáles son los 5 problemas más graves? E2E no ejecutable por DB local; actions críticas sin cobertura; PPA público sin TTL observable; Mantenciones/Flota incompletos para operación real; performance no medido.
- ¿Cuáles son los 5 módulos más débiles? Mantenciones, Flota, Repuestos, Servicios, PPA Digital.
- ¿Cuál es el mínimo necesario para poder desplegar con seguridad? E2E verde contra Postgres disposable, coverage de actions críticas, smoke build/imagen con DB real, token PPA con política de expiración, y plan operativo claro para módulos parcialmente completos.
