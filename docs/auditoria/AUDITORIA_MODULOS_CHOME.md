# Auditoría por Módulos — Chome Solicitudes y Bodega

## 1. Resumen ejecutivo

### Estado general
No está listo para producción sin restricciones. El build, typecheck, lint, secrets, Vitest, coverage y performance pasan con evidencia nueva; además `npm run test:e2e` ya arranca localmente sin credenciales manuales gracias a Postgres disposable. El E2E completo todavía no queda verde: 39 tests pasaron, 1 quedó skipped y se cortó tras fallas reales en PDF standalone, PPA y purchase-flow. El sistema mantiene una base funcional amplia, con RBAC server-side, scoping por faena, transacciones en compras/recepción/stock/entregas y exportaciones XLSX, pero aún quedan flujos browser y funcionalidades operativas incompletas.

### Nota global
7/10.

### Recomendación final
Listo para producción con restricciones.

Restricciones mínimas: E2E completo debe quedar verde; smoke de imagen productiva debe validarse con DB accesible; PDF standalone debe incluir/ubicar correctamente Playwright; PPA y purchase-flow deben actualizar sus specs/fixtures a la UI actual; las actions críticas bajo 50% deben seguir subiendo cobertura antes de liberar operación amplia.

### Principales riesgos
- `npm run test:e2e` ya no falla por credenciales locales: levanta/reusa `postgres:16` en `127.0.0.1:55432` y resetea `bodega_e2e`; el suite completo aún falla por problemas propios de PDF/PPA/purchase.
- `npm run perf:queries` se ejecutó contra DB desechable y todas las consultas medidas quedaron bajo SLO 1000 ms.
- Cobertura global aceptable pero desigual: 73.7% statements, 63.62% branches; `repuestos`, `servicios` y `mantenciones` ya no están en 0%, pero `admin/usuarios` sigue bajo.
- PPA público queda definido por producto como enlace permanente sin expiración automática. Se mitiga con vista pública mínima y revocación manual (`publicTokenRevokedAt`), no con TTL.
- Mantenciones y Flota avanzaron: auditoría create/update/cancel, campos documentales/vencimientos/responsable y detalle `/flota/[id]`; aún falta gestión completa de documentos y planificación preventiva.

### Estado de remediación — 2026-06-29

- Cerrado en código: E2E wrapper con Postgres disposable; preflight E2E contra DB de mantenimiento; perf ampliado con SLO 1000 ms; PPA permanente con revocación manual y vista pública reducida; `/api/trazabilidad/export` usa `traceability:view`; Repuestos/Servicios visibles en navegación; auditoría en mantenciones; export combustibles limitado a 10.000 filas con aviso; smoke Docker CI con Postgres real; cobertura directa inicial de actions críticas.
- Cerrado parcialmente: Flota agrega campos, documentos y detalle; Soporte agrega prioridad/SLA; Bodega, entregas y comprobante firmado tienen base de esquema; E2E admin/combustibles/negative-flow pasan con fixtures actualizados.
- Pendiente real: E2E completo no pasa por PDF standalone, PPA specs con Radix/export, y purchase-flow desactualizado; soporte adjuntos/ruta segura no quedó completo; conteo físico, comprobante firmado, analítica glossary/offline PPA/SST y conciliación OC-factura-recepción no quedaron implementados de punta a punta.

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
| npm run typecheck | Pasa | `tsc --noEmit` terminó con código 0 tras los cambios. | Global |
| npm run lint | Pasa | `eslint` terminó con código 0 tras los cambios. | Global |
| npm test | Pasa | 152 archivos passed, 4 skipped; 1517 tests passed, 4 skipped; duración 244.95s. | Global |
| npm run test:e2e | Falla con progreso | Ya arranca con Postgres disposable; ejecución completa observada: 39 passed, 1 skipped, 12 failed, 1 interrupted, 12 did not run. Fallas: PDF standalone, PPA Radix/export, purchase-flow. | UI/E2E |
| npm run test:coverage | Pasa con brechas | 73.7% statements, 63.62% branches, 79.97% functions, 75.36% lines. 152 files passed, 4 skipped. | Acciones de módulos críticos |
| npm run check:secrets | Pasa | `Env files check passed.` | Producción/seguridad |
| npm run perf:queries | Pasa | Ejecutado con `PERF_ALLOW_DESTRUCTIVE_RESET=true` contra `bodega_perf_test`; máximo observado 48.5 ms, bajo SLO 1000 ms. | Reportes, dashboard, analítica, trazabilidad, combustibles |

Verificación adicional ejecutada: `npm run db:generate` reporta `No schema changes, nothing to migrate`; `npm run build` pasa con Next.js 16.2.9 e incluye `/flota/[id]`.

---

## 3. Tabla resumen por módulo

| Módulo | Estado | Nota 1-10 | Listo para producción | Riesgo | Principales problemas |
|---|---:|---:|---:|---:|---|
| Administración | Completo con brechas de cobertura | 8 | Sí, con restricciones | Medio | `admin/usuarios/actions.ts` sube a 10.58%, pero sigue bajo; E2E admin pasa en subset. |
| Solicitudes | Funcional | 7 | Sí, con restricciones | Medio | Server Action con cobertura baja; purchase-flow E2E sigue fallando por spec/flujo desactualizado. |
| Repuestos | Parcialmente completo | 6 | No | Alto | Ya aparece en navegación y coverage actions sube a 88.88%, pero falta E2E real repuestos -> compras. |
| Servicios | Parcialmente completo | 6 | No | Alto | Ya aparece en navegación y coverage actions sube a 88.88%, pero falta E2E real servicios -> compras. |
| Aprobaciones | Funcional | 7 | Sí, con restricciones | Medio | Cobertura de actions 65%; requiere prueba E2E real y carrera concurrente de aprobación en CI. |
| Compras | Funcional robusto | 8 | Sí, con restricciones | Medio | Cobertura actions 49%; eliminación dura de OC requiere vigilancia operativa. |
| Recepción | Sólido | 8 | Sí, con restricciones | Medio | Buen control oficina/faena; depende de E2E real para prueba punta a punta. |
| Bodega / Stock | Sólido | 8 | Sí, con restricciones | Medio | Mutación centralizada y transaccional; actions 53% coverage. |
| Entregas | Sólido | 8 | Sí, con restricciones | Medio | Buen control de stock y trabajador; faltan firmas/comprobantes avanzados. |
| Trazabilidad | Bueno | 8 | Sí, con restricciones | Medio | Export y detalle existen; no cubre todos los eventos periféricos como devoluciones/ajustes en narrativa completa. |
| Reportes | Bueno | 7 | Sí, con restricciones | Medio | XLSX y filtros existen; perf inicial bajo SLO. |
| Analítica | Bueno pero sensible a rendimiento | 7 | Sí, con restricciones | Medio | Muchas agregaciones; perf inicial bajo SLO, falta glosario visible. |
| Evaluaciones SST | Funcional amplio | 7 | Sí, con restricciones | Medio | Cobertura del servicio decente, pero actions 25.82%; campo/UX debe validarse en terreno. |
| PPA Digital | Funcional con política pública permanente | 7 | Sí, con restricciones | Medio | Token público no expira por decisión de producto; tiene revocación manual y vista mínima, pero E2E PPA está desactualizado. |
| Combustibles | Funcional reciente | 7 | Sí, con restricciones | Medio | Export limitado a 10.000 filas y E2E subset verde; actions 40.9%, import API aún requiere casos extremos. |
| Flota | Vista consolidada ampliada | 6 | No | Alto | Agrega detalle, responsable, estado y vencimientos; faltan CRUD documental/alertas completas. |
| Mantenciones | Parcial con auditoría | 6 | No | Alto | CRUD básico con `recordAudit`; actions 27.9%; falta planificación preventiva. |
| Soporte / Feedback | Funcional | 8 | Sí, con restricciones | Bajo | Agrega prioridad/SLA; adjuntos/notificaciones ricas siguen pendientes. |

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
Existen tests de admin, scope, productos, trabajadores y RBAC. Brecha: coverage muestra `app/(app)/admin/usuarios/actions.ts` en 10.58%, todavía bajo.

#### Rendimiento
Riesgo bajo; listados admin acotados, pero usuarios/faenas deben paginarse si crecen.

#### Bugs encontrados
- `app/(app)/admin/usuarios/actions.ts`: cobertura baja; no demuestra por coverage todas las mutaciones más sensibles de RBAC.

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
Se integra con compras por ítems aprobados y ahora aparece en la navegación de Adquisiciones.

#### UI/UX
Formulario propio y detalle con panel de cotizaciones. Falta discoverability en navegación principal.

#### Tests
Hay tests de factory, validación y permisos; coverage reporta `app/(app)/repuestos/actions.ts` en 88.88%.

#### Rendimiento
Riesgo bajo/medio; usa queries directas y reutiliza flujo de solicitudes.

#### Bugs encontrados
- `modules/repuestos/manifest.ts`: `nav: []`; módulo registrado pero no visible por navegación principal.
- Pendiente: falta E2E repuestos -> compras con cotización seleccionada.

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
Tests de validation y factory; `app/(app)/servicios/actions.ts` aparece en 88.88%.

#### Rendimiento
Riesgo bajo/medio.

#### Bugs encontrados
- `modules/servicios/manifest.ts`: `nav: []`, módulo registrado pero no navegable desde sidebar.
- Pendiente: falta E2E servicios -> compras con cotización seleccionada.

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
- No se confirmó bug funcional. La brecha es cobertura insuficiente de actions críticas y purchase-flow E2E desactualizado.

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
Página y export API usan `traceability:view`, consistente con el manifest de trazabilidad.

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
- Corregido: `app/api/trazabilidad/export/route.ts` protege con `traceability:view`.

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
`ppa_submissions` almacena respuestas JSON, resultado, estado, public token, revocación manual de token y revisión.

#### Validaciones
Zod y evaluación pura; RUT validado para lookup.

#### Lógica de negocio
Estados `aprobado_auto`, `detenido`, `en_correccion`, `autorizado`, `rechazado`, `cerrado`.

#### Integraciones con otros módulos
Prevención, trabajadores, notificaciones, reportes.

#### UI/UX
Formulario público simple y panel interno.

#### Tests
PPA actions/service/stats/evaluation; se agregó prueba de token revocado. Coverage buena en actions públicas; `lib/services/ppa.ts` sigue bajo por muchas ramas sin cubrir. E2E PPA falla porque el spec usa `selectOption` sobre un Select Radix.

#### Rendimiento
Listados paginados; export sin límite explícito observado en route.

#### Bugs encontrados
- Política aceptada: `publicToken` no expira automáticamente por decisión de producto. Mitigación aplicada: `publicTokenRevokedAt` revoca manualmente el acceso y la vista pública de resultado queda reducida a datos mínimos.

#### Funcionalidades faltantes indispensables
UI/operación para revocar tokens desde panel interno; modo offline/de conexión mala; actualizar E2E PPA a Select Radix y confirmar export XLSX.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Agregar acción UI de revocación, mantener política pública permanente documentada y actualizar E2E PPA.

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
Tests de cálculos/import/reportes/vehículos/actions/export; coverage `app/(app)/combustibles/actions.ts` 40.9%. E2E combustibles pasa en subset.

#### Rendimiento
Perf ejecutado en DB disposable; consulta combustibles `cargas por mes` observada en 6.2 ms. Export de combustibles queda limitado a 10.000 filas y reporta truncado.

#### Bugs encontrados
- `app/(app)/combustibles/actions.ts`: cobertura baja en muchas mutaciones.
- Corregido: `exportFuelLoadsXlsxAction` aplica límite 10.000 y la UI avisa si el XLSX fue truncado.

#### Funcionalidades faltantes indispensables
Prueba de importación con archivo Excel real extremo y límite de export.

#### Severidad de hallazgos
Medio.

#### Nota del módulo
7/10.

#### ¿Listo para producción?
Sí, con restricciones.

#### Acciones recomendadas
Subir tests de actions restantes y ejecutar importación con archivo Excel real extremo.

---

### 4.16 Flota

#### Propósito funcional esperado
Vista consolidada y catálogo completo de vehículos con documentos, vencimientos, responsable e integración.

#### Implementación encontrada
`app/(app)/flota/page.tsx`, `app/(app)/flota/[id]/page.tsx`, `lib/services/fleet.ts`, datos desde `fuel_vehicles`, `fleet_vehicle_documents`, `fuel_loads`, `maintenance_records`.

#### Flujo real detectado
Vista de costos por vehículo, litros, cargas, mantenciones, faena, responsable, estado operacional y próximo vencimiento; detalle por vehículo.

#### Permisos y seguridad
`flota:view`; scoping por faena en servicio.

#### Base de datos y persistencia
Usa `fuel_vehicles` como fuente única del vehículo y agrega `fleet_vehicle_documents` para documentos con vencimiento/archivo.

#### Validaciones
No aplica a CRUD porque es lectura.

#### Lógica de negocio
Agregación simple y útil, pero no controla ciclo de vida documental.

#### Integraciones con otros módulos
Combustibles y mantenciones.

#### UI/UX
Vista consolidada y detalle por vehículo; todavía no hay flujo completo de carga/renovación documental.

#### Tests
`fleet-service.test.ts` cubre responsable, estado operacional y próximo vencimiento.

#### Rendimiento
Agrupa por vehículo; riesgo medio si crecen cargas y mantenciones sin índices suficientes.

#### Bugs encontrados
- Módulo esperado como flota empresarial, pero implementación real es vista consolidada mínima.

#### Funcionalidades faltantes indispensables
CRUD documental, subida/descarga segura de documentos, alertas por vencimiento y filtros avanzados por vencimiento/responsable.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No como módulo de flota completo.

#### Acciones recomendadas
Completar gestión documental y alertas; definir si flota será dueño del catálogo o seguirá delegando CRUD a combustibles.

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
CRUD básico con auditoría create/update/cancel; no hay planificación preventiva ni vencimientos próximos.

#### Integraciones con otros módulos
Flota y analítica.

#### UI/UX
Listado y formulario.

#### Tests
`maintenance-service`, `maintenance-validation` y wrapper actions; coverage de `app/(app)/mantenciones/actions.ts` 27.9%.

#### Rendimiento
Limit 100 en page data; adecuado como inicio, pero no paginación real.

#### Bugs encontrados
- Corregido: `lib/services/maintenance.ts` registra `recordAudit` en create/update/cancel con old/new state.
- Parcial: `app/(app)/mantenciones/actions.ts` ya no está en 0%, pero sigue bajo.

#### Funcionalidades faltantes indispensables
Plan preventivo, alertas, documentación, auditoría de cambios, historial de ediciones.

#### Severidad de hallazgos
Alto.

#### Nota del módulo
6/10.

#### ¿Listo para producción?
No.

#### Acciones recomendadas
Subir tests de actions restantes y agregar modelo/vista de planificación preventiva.

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
- Sin bug funcional confirmado; se agregó prioridad explícita y SLA calculado.

#### Funcionalidades faltantes indispensables
Adjuntos, ruta segura de descarga para adjuntos de feedback y notificaciones por estado.

#### Severidad de hallazgos
Bajo.

#### Nota del módulo
8/10.

#### ¿Listo para producción?
Sí, con restricciones menores.

#### Acciones recomendadas
Completar adjuntos y notificaciones si soporte será canal formal.

---

## 5. Hallazgos críticos globales

- Título: E2E completo aún no queda verde.
  Severidad: Alto.
  Módulos afectados: Todos.
  Evidencia técnica: `npm run test:e2e` ya arranca con Postgres disposable local, pero el completo observado terminó con 39 passed, 1 skipped, 12 failed, 1 interrupted y 12 did not run.
  Riesgo operativo: hay prueba browser real parcial, pero PDF/PPA/purchase siguen sin señal verde completa.
  Recomendación concreta: corregir PDF standalone, actualizar PPA/purchase specs y volver a ejecutar el completo.

- Título: Performance medido con SLO inicial.
  Severidad: Cerrado inicial.
  Módulos afectados: Reportes, Analítica, Dashboard, Trazabilidad, Combustibles.
  Evidencia técnica: `PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries` imprimió tabla completa; máximo observado 48.5 ms frente a SLO 1000 ms.
  Riesgo operativo: bajo para el dataset sintético actual; se debe mantener en CI o runbook.
  Recomendación concreta: archivar resultados por release y ampliar dataset si crece volumen real.

- Título: Cobertura desigual en Server Actions críticas.
  Severidad: Alto.
  Módulos afectados: Admin usuarios, Repuestos, Servicios, Mantenciones, Combustibles, Solicitudes, Compras, Prevención.
  Evidencia técnica: coverage actual reporta 10.58% en `admin/usuarios`, 88.88% en `repuestos`, 88.88% en `servicios`, 27.9% en `mantenciones`, 40.9% en combustibles, 36.61% solicitudes, 49.04% compras.
  Riesgo operativo: permisos y transiciones pueden romperse sin que CI lo detecte.
  Recomendación concreta: tests directos de Server Actions con sesiones scoped/globales y estados inválidos.

- Título: Permiso de export de trazabilidad alineado.
  Severidad: Cerrado.
  Módulos afectados: Trazabilidad, Reportes.
  Evidencia técnica: `/api/trazabilidad/export` exige `traceability:view`, conserva XLSX y límite 10.000.
  Riesgo operativo: bajo.
  Recomendación concreta: mantener test de permiso de ruta.

- Título: PPA público permanente por decisión de producto.
  Severidad: Aceptado con mitigación.
  Módulos afectados: PPA Digital, Prevención.
  Evidencia técnica: `ppa_submissions.publicTokenRevokedAt` permite revocación manual; `getPpaByToken()` devuelve `null` solo si fue revocado; la vista pública muestra datos mínimos.
  Riesgo operativo: enlace filtrado mantiene acceso mientras no se revoque.
  Recomendación concreta: agregar acción UI de revocación y procedimiento operativo; no agregar expiración automática.

---

## 6. Funcionalidades indispensables faltantes

- Seguridad: E2E completo verde, revocación UI de PPA permanente, cobertura de actions críticas.
- Administración: cobertura completa de usuarios/permisos y auditoría detallada de configuración.
- Compras: prueba real de email/PDF y conciliación básica OC-factura-recepción.
- Bodega: UI/actions de conteo físico/cierre de inventario y comprobantes firmados.
- Prevención: validación de terreno, modo degradado/offline para PPA/SST si se usará en faena.
- Vehículos: documentación, vencimientos, seguros, responsable y estado operacional.
- Reportes: mantener evidencia perf y límites consistentes en todos los exports.
- UX: actualizar E2E PPA/purchase a componentes Radix actuales.
- Operación: smoke Docker contra DB accesible y E2E completo sin fallas.
- Producción: runbook de ejecución de perf/E2E y SLO de consultas.

---

## 7. Riesgos de producción

- Riesgos críticos: ninguno confirmado en lógica de stock/recepción/compras durante esta auditoría.
- Riesgos altos: E2E completo falla en PDF/PPA/purchase; mantenciones/flota aún incompletos para operación integral.
- Riesgos medios: coverage desigual; PPA permanente depende de revocación manual; flota limitada; soporte sin adjuntos.
- Riesgos bajos: reportes contables avanzados fuera de alcance actual.

---

## 8. Plan de corrección recomendado

### Prioridad 1 — Bloqueante para producción
- Dejar `npm run test:e2e` completo en verde: PDF standalone, PPA Radix/export y purchase-flow.
- Subir tests de Server Actions para `admin/usuarios`, `mantenciones`, `combustibles`, `solicitudes`, `compras`, `bodega` y `prevencion`.
- Agregar UI/proceso de revocación para PPA permanente.

### Prioridad 2 — Alta
- Completar gestión documental de flota y vista preventiva de mantenciones.
- Completar adjuntos seguros en soporte y comprobante firmado en entregas.
- Implementar conciliación básica OC-factura-recepción.
- Mantener `perf:queries` en runbook/CI con DB disposable.

### Prioridad 3 — Media
- Subir coverage de combustibles, solicitudes, compras, bodega y prevención actions.
- Completar flota con carga/descarga de documentación, alertas de vencimiento y filtros.

### Prioridad 4 — Baja
- Adjuntos en soporte.
- Glosario visible de KPIs de analítica.
- Mejoras UX de terreno para PPA/SST.

---

## 9. Veredicto final

- ¿Está listo para producción? No para despliegue amplio sin restricciones. Sí podría ir a marcha blanca controlada si se limita el alcance, se respalda la DB y se excluyen los flujos E2E aún fallando hasta corregirlos.
- ¿Qué nota global obtiene del 1 al 10? 7/10.
- ¿Cuáles son los 5 problemas más graves? E2E completo aún falla; PDF standalone no genera en producción E2E; PPA/purchase specs desactualizados; actions críticas siguen bajo 50%; Mantenciones/Flota incompletos para operación real.
- ¿Cuáles son los 5 módulos más débiles? Mantenciones, Flota, PPA Digital por E2E, Compras por E2E/PDF, Admin usuarios por coverage.
- ¿Cuál es el mínimo necesario para poder desplegar con seguridad? E2E verde contra Postgres disposable, coverage de actions críticas, smoke build/imagen con DB real, política operacional de revocación PPA permanente y plan operativo claro para módulos parcialmente completos.
