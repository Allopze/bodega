# ANALITICA_TRANSVERSAL_CHOME

## Resumen ejecutivo

Se implementó una primera capa de analítica transversal para CHOME en la ruta `/analitica`. La solución cruza datos persistidos de compras, solicitudes, bodega, entregas de EPP, combustible, proveedores, faenas, usuarios indirectos por solicitud y vehículos disponibles en el módulo de combustibles.

La implementación evita inventar datos: cuando el modelo actual no permite calcular una métrica, la interfaz lo declara como brecha de trazabilidad. En particular, el costo operativo por vehículo hoy considera combustible; servicios, repuestos y mantenciones aún no tienen relación estructurada con vehículo.

## Módulos detectados

| Módulo | Rutas principales | Propósito | Estado para analítica |
| --- | --- | --- | --- |
| Dashboard | `/dashboard` | Cola operacional y resumen por faena | Existente, no sustituido |
| Solicitudes | `/solicitudes` | Solicitudes de compra/EPP/stock/repuestos/servicios | Fuente de tipo, requester, faena, estado y fechas |
| Aprobaciones | `/aprobaciones` | Decisiones sobre solicitudes | Fuente de tiempos de aprobación futura |
| Compras | `/compras` | Órdenes de compra, proveedores, montos, facturas | Fuente financiera principal |
| Recepción | `/recepcion` | Recepción oficina/faena | Fuente de cierre logístico |
| Bodega | `/bodega` | Stock por faena y movimientos | Fuente de stock crítico y rotación |
| Entregas | `/entregas` | Entregas a faena/trabajador | Fuente de EPP por trabajador/faena |
| Trazabilidad | `/trazabilidad` | Seguimiento de ítems | Fuente complementaria de auditoría |
| Reportes | `/reportes` | Reportes operativos XLSX existentes | Se amplió con exportación analítica |
| Combustibles | `/combustibles` | Cargas, proveedores, vehículos, cuenta corriente | Fuente vehicular real disponible |
| Flota | `/flota` | Gestión futura de flota | Página "Próximamente"; sin schema operativo propio |
| Mantenciones | `/mantenciones` | Gestión futura de mantenciones | Página "Próximamente"; sin schema operativo propio |
| Prevención/SST/PPA | `/prevencion`, `/prevencion/ppa` | Evaluaciones y prevención | No incluido en MVP financiero-operacional |
| Admin | `/admin/*` | Maestros, usuarios, faenas, proveedores, productos | Fuente de catálogos y permisos |

## Entidades y relaciones actuales

| Entidad | Campos útiles existentes | Relaciones útiles |
| --- | --- | --- |
| Orden de compra | `code`, `worksiteId`, `supplierId`, `status`, `createdAt`, `issuedAt`, `sentAt`, `totalAmount` | Faena, proveedor, creador, ítems, facturas |
| Ítem OC | `productId`, `requestItemId`, `quantity`, `unitPrice`, `subtotal`, recepciones | Producto, solicitud original, OC |
| Solicitud | `requestType`, `requesterId`, `worksiteId`, `status`, `submittedAt`, `closedAt`, `urgency` | Usuario solicitante, faena, ítems |
| Ítem solicitud | `productId`, `workerId`, `quantity`, `status`, `suggestedSupplierId` | Producto, trabajador, proveedor sugerido |
| Producto | `sku`, `name`, `categoryId`, `isEpp`, `referencePrice` | Categoría, proveedores preferidos, stock |
| Categoría producto | `name`, `slug`, `isEpp`, `requiresPrevencion` | Productos |
| Stock faena | `worksiteId`, `productId`, `quantity`, `minStock`, `lastMovementAt` | Faena, producto |
| Movimiento inventario | `type`, `quantity`, `referenceType`, `referenceId`, `performedBy`, `performedAt` | Producto, faena, usuario |
| Entrega | `destinationType`, `worksiteId`, `workerId`, `deliveredAt`, `deliveredBy` | Trabajador, faena, ítems |
| Carga combustible | `loadDate`, `month`, `vehicleId`, `fuelSupplierId`, `worksiteId`, `liters`, `totalAmount`, `status` | Vehículo, proveedor combustible, faena |
| Vehículo combustible | `plate`, `type`, `brand`, `model`, `worksiteId`, `isActive` | Cargas de combustible |
| Proveedor | `name`, `rut`, `isActive` | OCs, productos preferidos |
| Proveedor combustible | `name`, `rut`, `isActive` | Cargas y estados mensuales |
| Trabajador | `rut`, `firstName`, `lastName`, `position`, `worksiteId` | Solicitudes/entregas EPP |
| Usuario | `name`, `email`, roles, permisos, faenas asignadas | Solicitudes, OCs, movimientos |
| Faena | `name`, `code`, `region`, `isActive` | Compras, solicitudes, stock, entregas, combustible |

## Relaciones faltantes relevantes

| Falta | Entidad sugerida | Tipo sugerido | Obligatorio | Impacto |
| --- | --- | --- | --- | --- |
| Centro de costo | `purchase_orders`, `purchase_requests`, `fuel_loads`, `deliveries` | `text` FK a tabla nueva | Opcional al migrar, luego requerido | Permite gasto por centro de costo |
| Área solicitante | `purchase_requests` | `text` o FK a tabla `areas` | Opcional | Permite consumo por área |
| Obra/proyecto separado de faena | Tabla nueva o campo en `worksites` | FK | Opcional | Consolida faenas por obra |
| Vehículo asociado a OC/ítem | `purchase_order_items` o tabla de imputación | `vehicleId` nullable | Opcional | Permite costo vehículo combustible + repuestos + servicios |
| Tipo de imputación por ítem | `purchase_order_items` | enum: `epp`, `repuesto`, `servicio`, `stock`, `otro` | Opcional con backfill | Evita inferir desde solicitud original |
| Kilometraje/odómetro combustible | `fuel_loads` | numeric | Opcional inicial | Rendimiento km/L y costo/km |
| Horómetro combustible | `fuel_loads` | numeric | Opcional inicial | Rendimiento por hora máquina |
| Kilometraje/horómetro servicio | futuro módulo mantenciones | numeric | Requerido si aplica | Mantención por uso real |
| Cierre normalizado de OC | `purchase_orders` | `closedAt` timestamp | Opcional | Tiempo aprobación-recepción-cierre |
| Centro de costo en trabajador | `workers` o asignaciones históricas | FK | Opcional | Costo EPP por área/cargo |

## Indicadores implementados

### Ejecutivo transversal

- Gasto total del período: compras activas + combustible.
- Variación respecto al período anterior equivalente.
- Cantidad de órdenes de compra.
- Monto promedio por OC.
- Aprobaciones pendientes.
- Productos bajo stock mínimo.
- Litros y cargas de combustible.
- Alertas accionables.

### Compras

- Gasto mensual.
- Gasto por tipo de solicitud asociado a ítems de OC.
- Ranking de proveedores de OC.
- Ranking de faenas por gasto de OC.
- Órdenes recientes consideradas.

### Combustible y vehículos

- Gasto combustible por vehículo.
- Litros por vehículo.
- Cargas por vehículo.
- Ranking de vehículos más costosos con datos disponibles.
- Brecha explícita: no hay kilometraje/horómetro ni mantenciones reales vinculadas.

### Bodega e inventario

- Productos bajo stock mínimo.
- Rotación por egresos de entrega.
- Movimientos considerados por período.

### EPP

- EPP entregados por trabajador/faena.
- Alertas de entregas repetidas dentro del período.
- Cruce EPP comprado/entregado queda parcial hasta imputación de OC por tipo más robusta.

## Dashboards y gráficos implementados

Ruta nueva: `/analitica`.

Vistas incluidas:

- Tarjetas KPI ejecutivas.
- Filtros por rango de fechas, faena, proveedor de OC y vehículo.
- Línea de gasto mensual total, compras y combustible.
- Barras de gasto por tipo.
- Barras de gasto por faena.
- Barras de costo por vehículo.
- Tabla de proveedores.
- Tabla de stock crítico.
- Tabla de rotación de bodega.
- Tabla de EPP entregados.
- Tabla de órdenes recientes.
- Panel de alertas accionables.
- Panel de brechas de trazabilidad.

## Alertas implementadas

| Tipo | Severidad | Regla | Acción sugerida |
| --- | --- | --- | --- |
| `stock_bajo` | Crítica | `quantity < minStock` con `minStock > 0` | Reponer o trasladar antes de nuevas salidas |
| `trazabilidad_incompleta` | Media | Vehículo con combustible pero sin campos para cruzar mantención/repuesto/km | Agregar vehículo en OC/servicio y odómetro/horómetro |
| `epp_recurrente` | Media | 3 o más entregas de un EPP a la misma persona en el período | Revisar desgaste, cargo o stock permanente |
| `sin_datos` | Baja | Sin datos suficientes para el filtro | Ampliar rango o revisar carga de datos |

## Seguridad y permisos

Se creó el módulo vivo `analytics` con:

- `analytics:view`: ver `/analitica`.
- `analytics:export`: exportar XLSX de analítica.

Grants iniciales:

- Administrador: ver y exportar.
- Jefatura: ver y exportar.
- Secretaría: ver y exportar.
- Prevencionista: ver.
- Jefe de mantención: ver.

El servicio respeta scope por faena usando `isGlobalRole` y `visibleWorksiteIds`. Usuarios sin faenas visibles reciben agregaciones vacías y alerta de falta de datos.

## Exportación

Se agregó `tipo=analitica_resumen` al endpoint existente:

```text
/api/reportes/export?tipo=analitica_resumen&from=YYYY-MM-DD&to=YYYY-MM-DD
```

La exportación usa XLSX con `exceljs`, consistente con la regla del proyecto. No se agregó CSV.

## Cambios realizados

- Nuevo servicio: `lib/services/analytics.ts`.
- Nueva ruta: `app/(app)/analitica/page.tsx`.
- Nuevos componentes: `analytics-filters.tsx`, `analytics-charts.tsx`, `loading.tsx`.
- Nuevo manifest: `modules/analytics/manifest.ts`.
- Registro en `modules/registry.ts`.
- Exportación XLSX en `lib/reports/export.ts` y `app/api/reportes/export/route.ts`.
- Tests: `lib/__tests__/analytics-service.test.ts`, actualización de navegación y exportación.

## Riesgos técnicos

- Las consultas son agregadas y evitan traer miles de registros al frontend, pero aún no usan vistas materializadas.
- El gasto por tipo depende de la relación OC item -> solicitud item -> solicitud. Ítems libres o mixtos pueden quedar como `Otros`.
- El filtro global por tipo de compra no se expuso en UI porque una OC puede contener ítems de más de un tipo; requiere imputación por ítem para no sesgar totales.
- Combustible tiene catálogo propio de proveedores, separado de `suppliers`.
- Flota y mantenciones son módulos de navegación sin persistencia operativa; la analítica los trata como brecha, no como dato real.

## Recomendaciones de segunda etapa

1. Agregar tabla de centros de costo y relaciones opcionales con solicitudes, OCs, combustible y entregas.
2. Agregar `vehicleId` en ítems de OC o una tabla `vehicle_cost_allocations`.
3. Incorporar odómetro/horómetro en `fuel_loads`.
4. Implementar schema real de mantenciones con vehículo, proveedor, fecha, tipo, costo, km/horómetro.
5. Materializar agregaciones mensuales si el volumen crece.
6. Convertir umbrales de alerta en configuración administrable.
7. Extender exportación XLSX con hojas separadas por dominio.
8. Agregar drill-down desde gráficos hacia listas filtradas.

## Validación ejecutada

- `npx vitest run lib/__tests__/analytics-service.test.ts`
- `npx vitest run lib/__tests__/navigation.test.ts`
- `npx vitest run lib/__tests__/frozen-modular-migration.test.ts lib/__tests__/auth-bootstrap-permissions.test.ts`
- `npx vitest run lib/__tests__/report-export.test.ts`
- `npx vitest run lib/__tests__/report-export-route.test.ts`
- `npx eslint ...` sobre archivos modificados de analítica, exportación y manifest.
- `npx vitest run lib/__tests__/analytics-service.test.ts lib/__tests__/navigation.test.ts lib/__tests__/frozen-modular-migration.test.ts lib/__tests__/auth-bootstrap-permissions.test.ts lib/__tests__/report-export.test.ts lib/__tests__/report-export-route.test.ts`
- `git diff --check`
- `npm run build`
- `npm run lint`

`npm run build` pasó e incluyó `/analitica` como ruta dinámica. `npm run lint` pasó con 19 warnings existentes en archivos de combustibles, solicitudes y schema. `npx tsc --noEmit` aún falla por errores existentes en tests no relacionados (`change-password-action`, `feedback`, `requests-delete`, `sst-alerts`, `stock-export`, `trazabilidad-item`, entre otros).

## Actualización segunda etapa

Esta sección deja sin efecto las brechas del documento inicial que ya fueron implementadas.

- Se creó schema y migración Drizzle para `cost_centers`, `maintenance_records` y `vehicle_cost_allocations`.
- Se agregaron relaciones opcionales de centro de costo en solicitudes, OCs, combustible y entregas.
- Se agregaron `odometerReading` y `hourMeterReading` en `fuel_loads`.
- Se agregó `closedAt` en `purchase_orders`.
- `/flota` dejó de ser placeholder y ahora muestra catálogo operativo basado en `fuel_vehicles`, con combustible, mantenciones, imputaciones, últimas lecturas y drill-down a combustible/mantenciones.
- `/mantenciones` dejó de ser placeholder y ahora permite listar y registrar mantenciones con vehículo, proveedor, fecha, tipo, costo, km/horómetro, estado y datos documentales.
- La analítica de vehículos ahora suma combustible + mantenciones + imputaciones de vehículo.
- Las alertas configurables usan valores `analytics:*` en `system_settings`, con defaults seguros si no existen.
- `analitica_resumen` ahora exporta XLSX multihoja: KPIs, gasto mensual, proveedores, faenas, vehículos, stock, EPP, alertas y brechas.
- Se agregaron `/analitica`, `/flota` y `/mantenciones` al inventario de captura/auditoría.

Validación adicional ejecutada:

- `npx tsc --noEmit`
- `npm run db:generate`; segunda corrida: `No schema changes, nothing to migrate`.
- `npm run db:migrate`
- `npm run build`
- `npm run lint` pasó con 19 warnings preexistentes.
- `npx vitest run lib/__tests__/analytics-service.test.ts lib/__tests__/report-export.test.ts lib/combustibles/__tests__/import.test.ts lib/__tests__/auth-bootstrap-permissions.test.ts lib/__tests__/navigation.test.ts lib/__tests__/frozen-modular-migration.test.ts`
- Capturas autenticadas en `screenshots/analytics-transversal/` para `/analitica`, `/flota` y `/mantenciones` en desktop/mobile.
