# Plan de mejora de catálogos

Fecha del análisis: 2026-07-10

## Objetivo

Consolidar los catálogos de Plataforma Chome como fuentes reales de datos maestros,
eliminando pantallas auxiliares que hoy no gobiernan los formularios operativos y
unificando el comportamiento de búsqueda, edición, activación, auditoría y permisos.

El plan no propone reescribir los catálogos que ya funcionan. Prioriza integrar lo
existente, corregir inconsistencias y completar los flujos que quedaron a medio camino.

La unificación del flujo es un requisito principal: una persona que aprenda a mantener
Faenas debe reconocer inmediatamente cómo mantener Productos, Vehículos, Proveedores o
Taxonomía SST. Las reglas de negocio cambian por dominio; el modelo de interacción no.

## Registro de implementación

### Pasada 1 — integración efectiva de Productos (2026-07-10)

Implementado:

- Producto carga unidades activas y plantillas activas desde sus catálogos maestros en
  alta, edición, la ficha embebida y el Sheet del listado.
- `UOM_OPTIONS` dejó de ser la fuente del formulario. Los productos antiguos conservan
  su unidad como opción heredada señalizada hasta que se normalicen.
- La migración `0036_register_product_units.sql` registra de forma idempotente las
  unidades históricas y normaliza su representación sin borrar productos.
- Las plantillas ahora seleccionan una categoría real por identificador y nombre; las
  plantillas globales siguen disponibles para todas las categorías.
- El tipo de plantilla es controlado: al cambiar a `select` aparecen inmediatamente
  sus opciones y la validación existente sigue aplicando.
- Producto puede aplicar las plantillas de su categoría y reemplaza atributos con el
  mismo nombre normalizado, sin duplicarlos. Los atajos EPP siguen usando el mismo
  mecanismo de combinación.
- Se agregaron edición y reactivación/desactivación visibles para unidades y plantillas.
- `getProductForEdit` quedó alineado con `admin:products`; los permisos de importación
  permanecen reservados para cargar, revisar y confirmar lotes.
- Se añadieron pruebas para permisos de edición y deduplicación de atributos.

Verificación de la pasada:

- `npx vitest run app/(app)/admin/productos/product-form.helpers.test.ts lib/__tests__/admin-productos.test.ts lib/__tests__/admin-product-catalogs-actions.test.ts`: 28/28 pruebas.
- `npm run typecheck -- --pretty false`: correcto.

Faltante al terminar esta pasada:

- Fase 0 aún no tiene una composición `CatalogList`/`CatalogFormSheet` común ni una
  prueba de contrato para todos los catálogos; esta pasada reutiliza las composiciones
  existentes.
- Falta verificar en una base con datos reales la ejecución de la migración y revisar
  manualmente los productos con unidades heredadas.
- Fase 1 queda implementada en código; falta únicamente la revisión visual/funcional
  manual de los recorridos en cada entorno antes de considerarla validada en release.
- Fases 2 a 6 siguen pendientes: invariantes EPP y proveedor preferido, identidad
  `familyId`, advertencias accionables, mantenimiento XLSX, flota, identidad de
  proveedores, SST/PDTP, verificador de calidad, E2E y despliegue.

### Pasada 2 — invariantes de EPP/Prevención y proveedor preferido (2026-07-10)

Cierra el pendiente de verificación de datos reales que dejó la Pasada 1 y avanza la
Fase 2 (invariantes de Productos/EPP) en el subconjunto que no requiere una herramienta
de normalización/backfill dedicada.

Implementado:

- **Verificación de la migración `0036`**: se ejecutó `db:migrate` contra la base local.
  Los 53 productos existentes quedaron con `unit_of_measure = "unidad"`, registrada en
  `product_units`, y 0 productos quedaron con una unidad no registrada en el maestro.
  Cierra el pendiente de Fase 1 "revisar manualmente los productos con unidades
  heredadas" a nivel local; falta la misma verificación en cada entorno de despliegue.
- **Herencia explícita de `isEpp`/`requiresPrevencion` (Fase 2.1)**: se decidió que la
  categoría aporta el valor por defecto solo al crear un producto nuevo — al elegir
  categoría, el formulario precarga sus flags de EPP/Prevención — y que un producto
  existente conserva su propio valor explícito al editar (no se sobrescribe on category
  change). La divergencia entre producto y categoría no se bloquea; se hace visible como
  advertencia (ver punto siguiente). `ProductForm` ahora mantiene `requiresPrevencion`
  como estado controlado (antes era `defaultChecked`) para poder aplicar este default.
- **Proveedor preferido único (Fase 2.2, criterio de aceptación de Fase 2)**: se agregó
  un índice único parcial `product_suppliers_one_preferred_per_product` sobre
  `(product_id) WHERE is_preferred = true` (migración `0037_late_kronos.sql`, con una
  deduplicación previa idempotente por si algún entorno ya tenía más de un preferido por
  producto). `productSchema` valida con `superRefine` que como máximo un proveedor venga
  marcado preferido. En el formulario, marcar un proveedor como preferido desmarca
  automáticamente los demás (antes cada checkbox era independiente).
- **Advertencias accionables en el listado (Fase 2.4, parcial)**: cada fila de producto
  muestra un ícono de advertencia con tooltip cuando corresponde: sin precio
  referencial, sin proveedor preferido, EPP sin ningún atributo obligatorio, o
  configuración EPP/Prevención distinta de la de su categoría. La consulta de
  `/admin/productos` ahora trae `productSuppliers` y `isRequired` por atributo para
  poder calcularlas sin queries adicionales.
- Se añadió `lib/validation/masters.ts: productSchema` con la regla de un solo
  preferido, y pruebas para el helper puro `setPreferredSupplier` y `getProductWarnings`.

Verificación de la pasada:

- Verificación manual en base local (`psql`): 53/53 productos con unidad registrada,
  0 productos con más de un proveedor preferido antes y después de migrar.
- `npx vitest run app/(app)/admin/productos/product-form.helpers.test.ts
  app/(app)/admin/productos/product-list.helpers.test.ts lib/__tests__/admin-productos.test.ts
  lib/__tests__/validation-masters.test.ts lib/__tests__/admin-product-catalogs-actions.test.ts
  lib/__tests__/deliveries-service.test.ts lib/__tests__/full-flow-integration.test.ts
  app/(app)/solicitudes/request-form.helpers.test.ts app/(app)/solicitudes/product-picker.helpers.test.ts
  app/(app)/solicitudes/request-form.test.tsx lib/products/variant-grouping.test.ts
  lib/services/epp-import.test.ts`: 138/138 pruebas.
- `npx eslint` sobre todos los archivos modificados: sin hallazgos.
- `npm run typecheck -- --pretty false`: correcto.
- `npx vitest run` (suite completa del repo, 243 archivos): 2229/2230 pruebas pasan.
  Queda **1 falla preexistente y no relacionada con esta pasada** en
  `scripts/capture-all-routes.test.ts`: el inventario de rutas para el audit de
  screenshots no incluye `/admin/productos/importar/[batchId]` (la vista de revisión de
  lotes EPP). No se tocó en esta pasada — requiere sembrar un lote de importación EPP de
  prueba en `scripts/capture-all-routes.ts`, algo ajeno al alcance de catálogos. Queda
  registrado como pendiente suelto, no como parte de las fases del plan.

Faltante al terminar esta pasada:

- Fase 0 sigue sin una composición común entre catálogos (sin cambios respecto a la
  Pasada 1).
- **Fase 2.3 — identidad `familyId`**: no se tocó. El `identityKey` del importador EPP
  (`lib/services/epp-import.ts`) incluye hoy los atributos de la fila (Talla/Color/etc.),
  por lo que agrupa por variante exacta y no por familia real; el formulario manual de
  producto tampoco setea `familyId` (siempre queda `null`). El listado sigue agrupando
  por nombre normalizado (`lib/products/variant-grouping.ts`), no por `familyId`. Cambiar
  esto requiere primero decidir qué compone la identidad de familia (sin atributos de
  variante) y ejecutar la normalización previa revisable que pide el plan — no es un
  cambio seguro de aplicar sin esa herramienta, así que se deja explícitamente pendiente.
- **Fase 2.5 — XLSX de mantenimiento para productos/proveedores/trabajadores**: no se
  implementó; es una superficie nueva por entidad (selección, previsualización, resumen)
  y se prioriza fuera de esta pasada.
- La advertencia "EPP sin atributos obligatorios" se calcula por variante seleccionada,
  no a nivel de familia — una familia con variantes mixtas (algunas con atributo
  obligatorio, otras sin él) puede mostrar la advertencia solo en algunas filas del
  selector. Aceptable por ahora; Fase 0 debería resolver cómo se agregan advertencias a
  nivel de familia cuando exista una composición común de listado.
- Fases 3 a 6 siguen pendientes sin cambios: flota, identidad de proveedores, SST/PDTP,
  verificador de calidad, E2E y despliegue.

### Pasada 3 — catálogo de flota (2026-07-10)

Implementa la Fase 3 en el subconjunto que no requiere una tabla de alias para el campo
`type` (heredado y deliberadamente texto libre, ver evidencia de código más abajo).

Implementado:

- **Vehículos migrado a `DataTable`**: `vehicle-table.tsx` dejó de usar una `<Table>`
  plana. Ahora tiene búsqueda del TopBar (`searchKeys`: patente, código, tipo, faena,
  responsable), orden, paginación y tarjetas móviles, igual que Productos.
- **"Nuevo vehículo" ya no vive en `headerActions`**: siguiendo el patrón real que ya usa
  Productos (no el literal "`PageHeader.actions`" del texto del plan, que Productos
  tampoco usa), el botón ahora está en la barra de acciones del propio `DataTable`, que
  se renderiza en el contenido de la página y por lo tanto es visible en móvil — el
  defecto real reportado ("no aparece en el encabezado móvil compartido") queda resuelto.
  Ajusté la lectura de la Fase 3 a la convención real para no introducir una segunda
  variante del mismo patrón entre catálogos.
- **Activar/desactivar reversible**: `deleteFuelVehicleAction` (solo desactivaba) se
  reemplazó por `toggleFuelVehicleActiveAction(id, activate)`. Desactivar conserva el
  `ConfirmDialog` existente (impacto operativo); reactivar es una acción directa, igual
  que en Productos.
- **Un solo `Sheet` de mantenimiento con pestañas** (`vehicle-form.tsx`) reemplaza los dos
  diálogos planos (`new-vehicle-dialog.tsx`/`edit-vehicle-dialog.tsx`, eliminados). Pestaña
  General (patente, código, tipo, marca, modelo, año, faena) y Estado y vigencias
  (responsable, estado operacional, vencimientos SOAP/revisión técnica/permiso de
  circulación/seguro, N° de póliza, notas). Se agregó una pestaña Documentos, solo en
  edición, que enlaza a la ficha en `/flota/[id]` en vez de duplicar ahí el CRUD de
  documentos que ya existe y funciona en la vista operacional.
- **Todos los campos de gobierno del esquema ahora son editables**: `responsibleUserId`,
  `operationalStatus`, las 4 fechas de vigencia y `insurancePolicyNumber` se agregaron a
  `createFuelVehicleSchema`/`updateFuelVehicleSchema` y se leen en ambas acciones — antes
  ninguno de estos campos era alcanzable desde el formulario, solo visibles de solo
  lectura en `/flota/[id]`.
- **`fleet.default_vehicle_status` ahora se aplica**: `createFuelVehicleAction` usa
  `getFleetAdminSettings().defaultVehicleStatus` cuando el formulario no envía un estado
  operacional explícito, en vez de depender del default fijo `"operativo"` de la columna.
- **`fleet.document.warning_days` ahora se consume**: `/flota/page.tsx` y
  `fleet-filters.tsx` dejaron de tener `30` (días) hardcodeado en tres lugares (banner de
  vencidos/próximos, filtro "próximos a vencer", y su etiqueta) y ahora leen
  `getFleetAdminSettings().warningDays`. Cambiar el parámetro en
  `/admin/flota-catalogos` ahora sí cambia qué se considera "próximo a vencer".
- **Enlaces del hub filtrados por permiso real**: `catalog-links.tsx` dejó de ser un
  array puramente decorativo — cada enlace declara su `permission` tipado contra el
  registro real (`Permission` de `modules/permissions.ts`), y el componente (ahora un
  server component, no necesitaba `"use client"`) filtra por
  `session.user.permissions` antes de renderizar. De paso quedó corregido el permiso
  inventado `flota:manage` (no existía en ningún manifest) por el real
  `mantenciones:view`, que es el que efectivamente protege `/mantenciones`.

Verificación de la pasada:

- `npx vitest run` sobre combustibles/flota/admin-flota-catalogos (19 archivos): 94/94
  pruebas.
- `npx vitest run` (suite completa del repo, 244 archivos): 2237/2238 pruebas pasan.
  La única falla es la misma preexistente y no relacionada reportada al cierre de la
  Pasada 2 (`scripts/capture-all-routes.test.ts`, falta `/admin/productos/importar/[batchId]`
  en el inventario de rutas del audit de screenshots). Ningún cambio de esta pasada
  introdujo regresiones.
- `npx eslint` sobre todos los archivos modificados: sin hallazgos.
- `npm run typecheck -- --pretty false`: correcto.

Faltante al terminar esta pasada:

- **Fase 3.10 — normalizar tipos heredados de vehículo**: no se tocó. `type` sigue siendo
  texto libre a propósito (comentario ya existente en `lib/combustibles/validation.ts`
  explica que el catálogo real tiene ~17 valores libres sembrados que no calzan con la
  lista canónica de 13). Crear una tabla de alias/catálogo explícito y migrar esos
  valores es un trabajo de datos separado, no incluido aquí.
- **Fase 3.8 — `/admin/flota-catalogos` como agrupador o retiro**: no se tocó más allá
  del arreglo de permisos. Convertirlo en agrupador del hub principal está entrelazado
  con la Fase 0 (que sigue sin empezar) y decidir su forma final antes de esa fase sería
  construir sobre un contrato todavía inexistente.
- La gestión de documentos del vehículo (subir/eliminar archivos) sigue solo en
  `/flota/[id]`, no en el nuevo `Sheet` administrativo — decisión deliberada para no
  duplicar ese CRUD (ver "Implementado" arriba), pero significa que un administrador
  necesita dos pantallas para completar el mantenimiento de un vehículo con documentos.
- No se agregó prueba de componente (RTL) para `VehicleForm`/`VehicleCatalogTable` — se
  siguió el mismo criterio que con `ProductForm` en las pasadas 1 y 2: las pruebas cubren
  las acciones de servidor y la lógica pura, no la interacción de React en sí.
- Fases 0, 2.3, 2.5, 4, 5 y 6 siguen pendientes sin cambios respecto a la Pasada 2.

## Alcance revisado

- Productos y EPP, categorías, atributos, unidades y proveedores preferidos.
- Proveedores generales y proveedores de combustible.
- Faenas, trabajadores y centros de costo.
- Vehículos y parámetros administrativos de flota.
- Taxonomía documental SST.
- Responsables y hojas del programa preventivo PDTP.

Quedan fuera los registros operacionales, como cargas de combustible, solicitudes,
órdenes de compra, recepciones, entregas, evaluaciones y programas PDTP ejecutados.

## Principio rector: un solo sistema de catálogos

Todos los datos maestros deben sentirse como partes del mismo sistema, no como módulos
independientes construidos con criterios distintos. El contrato común será obligatorio
para cada catálogo nuevo y se aplicará gradualmente a los existentes.

### Una sola puerta de entrada

- El hub `/admin` será la entrada canónica para todos los maestros.
- Los catálogos se agruparán por dominio, pero no tendrán hubs intermedios con patrones
  distintos: Operación, Productos y compras, Flota, Prevención y Gobierno.
- Vehículos y proveedores de combustible seguirán disponibles desde sus módulos
  operacionales cuando aporte contexto, pero ambos enlaces abrirán la misma superficie
  canónica de administración.
- Las rutas antiguas podrán redirigir o enlazar a la ruta canónica. No se mantendrán dos
  pantallas diferentes para editar la misma entidad.

### Un solo recorrido aprendido

El recorrido estándar será:

1. Entrar a Administración y elegir el catálogo.
2. Buscar desde el TopBar y aplicar filtros estructurados en la página cuando existan.
3. Ver un `DataTable` con el mismo orden, paginación, estado vacío y adaptación móvil.
4. Crear desde la acción primaria del `PageHeader`.
5. Editar desde la fila o su acción contextual.
6. Guardar o cancelar desde un pie de formulario consistente.
7. Activar o desactivar desde la misma acción de estado, con confirmación cuando el
   cambio tenga impacto operativo.
8. Recibir el mismo tipo de confirmación, error de campo y mensaje de permisos.

### Un solo patrón de listado

Todos los catálogos usarán:

- `PageContainer` y `PageHeader` para contexto y acción principal.
- Búsqueda textual del TopBar, sin cajas de búsqueda duplicadas en el contenido.
- `DataTable` para búsqueda, orden, paginación, estados vacíos y representación móvil.
- Filtros estructurados consistentes para Estado, Categoría, Faena u otros campos de
  dominio.
- Una columna de Estado con el mismo vocabulario: Activo e Inactivo. Los estados
  operacionales adicionales, por ejemplo En mantención, se muestran aparte.
- Acciones de fila en el mismo orden: Editar y Activar/Desactivar. Las acciones poco
  frecuentes irán en un menú contextual.
- Registros inactivos visibles mediante filtro, nunca desaparecidos sin forma de
  recuperación.

### Un solo patrón de formulario

- Los formularios simples se abrirán en el `Sheet` administrativo compartido.
- Productos y Vehículos también usarán el mismo `Sheet`, dividido en pestañas cuando
  la cantidad de datos lo exija: General, Atributos/Documentos, Proveedores/Responsable
  e Historial según corresponda.
- En móvil, el mismo `Sheet` se comportará como una superficie de ancho completo; no se
  creará un flujo móvil paralelo.
- Campos, etiquetas, ayudas, errores, acciones y estados de carga usarán `Field`,
  controles UI compartidos, `SubmitButton` y el mismo pie Guardar/Cancelar.
- No se alternará arbitrariamente entre diálogos, sheets, formularios inline y páginas
  completas para la misma clase de tarea.
- Una página de detalle independiente solo se justificará para consultar historia o
  ejecutar operaciones complejas, no para duplicar el CRUD del catálogo.

### Un solo ciclo de vida

- Crear, editar, activar y desactivar serán las operaciones base.
- El borrado físico no formará parte del flujo normal de maestros con historia.
- Desactivar conserva relaciones históricas y evita que el registro aparezca en nuevas
  selecciones operativas.
- Reactivar estará disponible desde el mismo listado.
- Toda mutación comprobará existencia, permiso y alcance, y registrará el estado real
  anterior y posterior en auditoría.

### Una sola experiencia de importación

- Toda carga masiva utilizará XLSX.
- El patrón será siempre: seleccionar archivo, previsualizar, mostrar errores por fila,
  decidir crear/actualizar/omitir, confirmar y ver un resumen auditable.
- Productos/EPP será la implementación de referencia. Los importadores de Vehículos,
  Proveedores y Trabajadores reutilizarán la experiencia y el contrato de estados del
  lote, no flujos de carga independientes.

### Qué se comparte y qué no

Se compartirán la estructura de página, tabla, formulario, acciones, estados, feedback,
permisos visibles y contrato de importación. No se intentará convertir todas las reglas
de negocio en un CRUD genérico: EPP conserva atributos y proveedor preferido; Flota
conserva documentos y vencimientos; SST conserva vigencias y aprobaciones.

La meta es una sola forma de usar el sistema, no un único modelo de datos artificial.

## Diagnóstico ejecutivo

| Catálogo | Estado | Diagnóstico |
|---|---|---|
| Faenas | Bien | CRUD, búsqueda, orden, activación, permisos por alcance y auditoría coherentes. |
| Trabajadores | Bien | CRUD, búsqueda, vista móvil, RUT normalizado, alcance por faena y activación. |
| Proveedores generales | Bien con ajustes menores | Ficha comercial completa, búsqueda y activación. Falta endurecer la lectura previa al cambio de estado y definir su relación con proveedores de combustible. |
| Centros de costo | Bien, aún sin adopción local | CRUD y activación correctos. Conviene validar explícitamente el alcance de faena cuando el permiso deje de ser exclusivamente global. |
| Productos y EPP | Funcional y avanzado | Tiene categorías, atributos, proveedores, variantes agrupadas, importación XLSX revisable y presets EPP. Desde la Pasada 2: un solo proveedor preferido reforzado en zod + índice único parcial, EPP/Prevención con default por categoría y advertencia de divergencia visible en el listado. Sigue pendiente `familyId` como identidad real de familia (Fase 2.3) y el mantenimiento XLSX de proveedores/trabajadores (Fase 2.5). |
| Unidades y plantillas de atributos | Cumplen su propósito desde la Pasada 1 | El formulario de producto consume `product_units` y `product_attribute_templates` activos en alta, edición y el Sheet del listado; los productos antiguos conservan su unidad heredada señalizada. La plantilla `select` es controlada y muestra sus opciones al instante. |
| Vehículos | Bien desde la Pasada 3 | `DataTable` con búsqueda/orden/paginación/móvil, `Sheet` único con pestañas, activar/desactivar reversible, y todos los campos de gobierno del esquema (responsable, estado, vigencias, póliza) editables. Queda pendiente normalizar `type` (texto libre heredado) y decidir el futuro de `/admin/flota-catalogos` junto con la Fase 0. |
| Parámetros de flota | Efectivo desde la Pasada 3 | El estado predeterminado se aplica al crear un vehículo y los días de aviso configurados determinan qué se considera "próximo a vencer" en `/flota`. |
| Proveedores de combustible | Funcional básico | Permite crear, editar y desactivar, pero no buscar, ordenar, reactivar ni reutilizar el maestro general de proveedores. |
| Taxonomía SST | Bien | Categorías y tipos tienen edición, activación, búsqueda, reglas de vigencia y siembra idempotente. CTAs unificados (solo DataTable). Auditoría con estado anterior real desde la Pasada 10. |
| Catálogos PDTP | Funcional desde la Pasada 10 | Responsables y hojas tienen CRUD, búsqueda, activación/desactivación reversible con auditoría real. Roles se cargan dinámicamente desde el registry. |

## Evidencia confirmada en código

### 1. Los catálogos auxiliares de productos no gobiernan el producto

- Antes de la pasada, `ProductForm` usaba `UOM_OPTIONS`, un arreglo estático, y no
  consultaba `product_units`; ahora consume unidades activas y conserva una opción
  heredada explícita para datos antiguos.
- Antes de la pasada, `product_attribute_templates` solo se consultaba desde su propia
  página; ahora las plantillas activas llegan a Producto y pueden aplicarse sin
  duplicar atributos.
- Antes de la pasada, el formulario de plantillas calculaba el campo de opciones solo
  con el valor inicial; ahora el tipo controlado lo revela al cambiar a `select`.
- Antes de la pasada, la categoría de una plantilla era texto libre; ahora es un
  `Select` con nombre e identificador reales.
- La normalización automática de unidades ya está preparada en migración, pero la
  ejecución en cada entorno y la revisión de datos heredados siguen pendientes.

### 2. Productos y EPP tienen buenas capacidades, pero faltan invariantes

- El catálogo ya soporta atributos normalizados, presets de talla/color, proveedores
  asociados, importación XLSX por lote y agrupación visual de variantes.
- `isEpp` y `requiresPrevencion` existen tanto en categoría como en producto, sin una
  regla explícita de herencia o sobrescritura. Hoy pueden divergir.
- La UI habla de un proveedor preferido, pero la validación y la base permiten marcar
  más de uno para el mismo producto.
- `getProductForEdit` exige `admin:epp_import_review`, aunque la página y las
  mutaciones de producto usan `admin:products`. Un permiso personalizado puede ver y
  crear productos, pero no editarlos.
- El esquema tiene familias EPP y el importador las usa, mientras la agrupación de la
  lista se basa solo en el nombre normalizado. Debe definirse una única identidad de
  familia.

### 3. Flota expone menos información de la que el dominio ya modela

- `fuel_vehicles` contiene estado operacional, responsable, SOAP, revisión técnica,
  permiso de circulación, póliza/seguro, vencimientos, notas y documentos.
- Los formularios de vehículo solo exponen patente, código, tipo, marca, modelo, año y
  faena.
- El botón "Nuevo vehículo" se entrega mediante `headerActions`, por lo que no aparece
  en el encabezado móvil compartido.
- La tabla no usa `DataTable`: no tiene búsqueda del TopBar, orden, paginación ni vista
  móvil dedicada.
- Desactivar es irreversible desde la UI, aunque los registros inactivos siguen en la
  tabla.
- `fleet.default_vehicle_status` se guarda, pero `createFuelVehicleAction` deja que la
  base aplique siempre `operativo`.
- `fleet.document.warning_days` se guarda, pero no participa en el servicio que calcula
  vencimientos.
- Los enlaces del hub de flota declaran permisos, pero no los filtran. Un usuario puede
  recibir un enlace que termina en `/forbidden`.

### 4. Hay dos maestros de proveedores sin relación explícita

- Compras usa `suppliers` y combustible usa `fuel_suppliers`.
- Ambos duplican nombre, RUT y datos de contacto.
- La separación puede ser válida por sus relaciones financieras, pero hoy no existe un
  vínculo que evite duplicidad o diferencias de identidad.

### 5. La experiencia no es uniforme entre catálogos

- Faenas, trabajadores, proveedores generales y centros de costo usan `DataTable`,
  búsqueda del TopBar, activación reversible y tarjetas móviles.
- Vehículos y proveedores de combustible usan tablas simples, sin búsqueda ni
  reactivación.
- Taxonomía SST muestra el CTA de creación en el encabezado de sección y nuevamente en
  `DataTable`.
- PDTP permite editar, pero no archivar o desactivar responsables y hojas. Sus roles se
  codifican en el cliente y pueden desviarse del registry que valida el servidor.

## Foto de la base local revisada

La consulta fue de solo lectura contra `DATABASE_URL` de `.env.local`; no representa
necesariamente producción.

| Dato | Resultado local |
|---|---:|
| Productos | 53, todos activos y EPP |
| Categorías de producto | 1 |
| Atributos de producto | 81 |
| Productos sin proveedor asociado/preferido | 0 / 0 |
| Productos sin precio referencial | 1 |
| Unidades maestras | 0 |
| Plantillas de atributos | 0 |
| Productos cuya unidad no está registrada en el maestro | 53 |
| Familias EPP persistidas | 0 |
| Faenas / trabajadores / proveedores | 9 / 146 / 2 |
| Centros de costo | 0 |
| Vehículos / proveedores de combustible | 0 / 0 |
| Categorías y tipos SST | 0 / 0 |
| Responsables y hojas PDTP | 0 / 0 |

La base local confirma que el catálogo principal de EPP sí está en uso, mientras los
catálogos auxiliares nuevos todavía no participan del flujo real.

> Nota (Pasada 2, 2026-07-10): esta foto es el diagnóstico original y se conserva sin
> tocar como evidencia de partida. Tras aplicar `0036` y `0037`, las filas "Unidades
> maestras" (ahora 1: `unidad`), "Productos cuya unidad no está registrada en el
> maestro" (ahora 0) y "Productos sin proveedor asociado/preferido" (confirmado 0 / 0,
> sin duplicados de preferido) quedaron verificadas y resueltas localmente. El resto de
> la foto (familias EPP, flota, SST, PDTP) sigue representando el estado real: esas
> áreas no se tocaron en esta pasada.

## Plan de implementación

### Fase 0. Establecer el contrato unificado de catálogos

Prioridad: crítica y previa a las demás fases.

1. Documentar el contrato anterior en el sistema de diseño y convertirlo en checklist
   obligatorio para páginas de administración.
2. Crear una composición compartida y pequeña para listados de catálogo sobre
   `PageHeader`, `DataTable`, filtros y acciones. No introducir un motor CRUD genérico.
3. Definir el `CatalogFormSheet` o una composición equivalente para encabezado, cuerpo,
   errores y pie Guardar/Cancelar, reutilizando los componentes existentes.
4. Tomar Faenas/Trabajadores como referencia de listado y Producto como referencia de
   formulario con pestañas.
5. Unificar el vocabulario visible: Nuevo, Editar, Guardar cambios, Activar, Desactivar,
   Activo, Inactivo, Sin resultados y Aún no hay registros.
6. Definir rutas canónicas bajo Administración y redirecciones desde superficies
   duplicadas. Los módulos operacionales podrán enlazar al catálogo sin clonarlo.
7. Añadir una prueba de contrato que verifique `PageHeader.actions`, conexión con la
   búsqueda del TopBar, vista móvil y reactivación para cada catálogo registrado.

Criterios de aceptación:

- Todos los catálogos tienen una ruta canónica visible desde `/admin`.
- Aprender un catálogo permite anticipar correctamente cómo buscar, crear, editar,
  desactivar y reactivar en los demás.
- No existen dos formularios de mantenimiento distintos para la misma entidad.
- Las diferencias de dominio aparecen dentro del formulario, no como flujos de
  navegación incompatibles.

### Fase 1. Hacer efectivos los catálogos de producto

Prioridad: crítica.

1. Cargar unidades activas y plantillas activas junto con categorías y proveedores en
   las páginas de creación/edición de producto.
2. Reemplazar `UOM_OPTIONS` por `product_units`, conservando como opción heredada el
   valor actual de productos antiguos.
3. Cambiar la categoría de plantilla desde un texto libre a un `Select` con nombre e
   identificador reales.
4. Hacer controlado el tipo de plantilla para que `select` muestre y valide sus
   opciones al instante.
5. Al elegir categoría en un producto, ofrecer "Aplicar plantillas de la categoría" y
   evitar duplicar atributos por nombre normalizado.
6. Mantener los atajos EPP, pero implementarlos como plantillas maestras sembradas o
   como accesos rápidos que reutilizan el mismo modelo.
7. Crear una migración de datos que registre las unidades ya usadas. No editar
   migraciones ni el journal existentes.
8. Alinear `getProductForEdit` con `admin:products`; reservar permisos de importación
   solo para cargar, revisar y confirmar lotes.

Criterios de aceptación:

- Un administrador puede crear una unidad y verla inmediatamente en Producto.
- Una plantilla `select` nueva permite ingresar opciones y aplicarlas a un producto.
- Ningún producto activo queda con una unidad fuera del catálogo, salvo una excepción
  heredada señalizada y corregible.
- Un usuario con `admin:products` puede completar todo el CRUD sin permisos de
  importación.

### Fase 2. Definir y proteger invariantes de productos/EPP

Prioridad: alta.

1. Decidir si `isEpp` y `requiresPrevencion` se heredan de categoría o si el producto
   puede sobrescribirlos. Representar esa decisión explícitamente en UI y servicio.
2. Garantizar un máximo de un proveedor preferido por producto en validación y, si
   PostgreSQL lo permite sin romper datos existentes, mediante índice único parcial.
3. Definir `familyId` como identidad canónica de familia EPP. Usar un fallback por
   nombre solo para registros heredados y ejecutar una normalización previa revisable.
4. Mostrar en la lista advertencias accionables: sin precio, sin proveedor preferido,
   sin atributos requeridos o con configuración divergente.
5. Añadir importación/exportación XLSX de mantenimiento para productos, proveedores y
   trabajadores. Nunca CSV.

Criterios de aceptación:

- No se puede guardar más de un proveedor preferido.
- Categoría y producto no divergen silenciosamente en reglas EPP/Prevención.
- Todas las variantes EPP quedan asociadas a una familia explícita o marcadas para
  revisión.

### Fase 3. Completar el catálogo de flota

Prioridad: crítica antes de usar flota con datos reales.

1. Convertir vehículos a `DataTable` con búsqueda del TopBar, orden, paginación, estado
   vacío y vista móvil.
2. Mover "Nuevo vehículo" a `PageHeader.actions` para que esté disponible en desktop y
   móvil.
3. Reemplazar la acción destructiva visual por activación/desactivación reversible.
4. Reemplazar los diálogos propios de Vehículos por el mismo `Sheet` de mantenimiento
   usado por los demás catálogos, con pestañas para General, Responsable, Documentos y
   Vigencias.
5. Crear una ficha/editor de vehículo que permita mantener estado operacional,
   responsable, notas, vencimientos, seguro y documentos sin duplicar ese CRUD en la
   vista operacional de Flota.
6. Aplicar `fleet.default_vehicle_status` en la creación.
7. Consumir `fleet.document.warning_days` en el cálculo de alertas y mostrar vencido,
   por vencer y vigente con fechas concretas.
8. Convertir `/admin/flota-catalogos` en un agrupador del hub principal o retirarlo como
   paso intermedio; no debe introducir un segundo modelo de navegación.
9. Filtrar los enlaces según permisos reales y dirigirlos a las superficies canónicas
   de administración.
10. Normalizar tipos heredados mediante un catálogo explícito o una tabla de alias, sin
   impedir editar valores antiguos.

Criterios de aceptación:

- El alta respeta el estado predeterminado configurado.
- El cambio de días de aviso modifica las alertas visibles.
- Todos los campos de gobierno del esquema se pueden mantener desde la UI.
- No hay acciones administrativas invisibles en móvil ni enlaces que terminen en
  `/forbidden` para el mismo usuario.

### Fase 4. Resolver la identidad de proveedores

Prioridad: alta antes de poblar combustible.

1. Elegir una de estas dos estrategias mediante ADR:
   - maestro único `suppliers` con capacidades, por ejemplo compra y combustible; o
   - `fuel_suppliers` especializado, enlazado obligatoriamente a `suppliers` mediante
     `supplierId`.
2. Recomendación: conservar la entidad especializada de combustible por sus relaciones
   financieras, pero enlazarla al proveedor general para compartir identidad, RUT y
   contacto.
3. Mantener un único formulario de identidad del proveedor. La sección de combustible
   será una capacidad o pestaña especializada, no un segundo formulario con nombre,
   RUT y contacto repetidos.
4. Preparar una importación XLSX con previsualización, detección de RUT/nombre duplicado
   y confirmación humana.
5. Migrar la tabla de proveedores de combustible al contrato común de `DataTable` y
   reactivación, o retirarla si la capacidad queda integrada al maestro general.

Criterios de aceptación:

- Un mismo RUT no puede representar dos identidades contradictorias.
- Combustible conserva sus relaciones contables sin duplicar datos comerciales.
- La desactivación no elimina historia y siempre puede revertirse con permiso.

### Fase 5. Homogeneizar SST, PDTP y catálogos centrales

Prioridad: media.

1. Definir un contrato de UX compartido: buscar, ordenar, crear, editar,
   activar/desactivar, estado vacío, móvil y auditoría del estado real anterior.
2. Eliminar CTAs duplicados en Taxonomía SST y usar una sola acción contextual.
3. Cargar roles PDTP desde el registry en el servidor y pasarlos al formulario, sin
   `ROLE_OPTIONS` codificado en el cliente.
4. Añadir archivo/activación a responsables y hojas PDTP. No borrar elementos ya
   referenciados por programas.
5. Validar el alcance de faena en centros de costo si ese permiso se concede a roles
   con alcance parcial.
6. Hacer que cada acción de cambio de estado lea la fila actual y audite el valor real,
   en vez de inferirlo como el opuesto solicitado.

Criterios de aceptación:

- Todos los catálogos comparten el mismo comportamiento de búsqueda y ciclo de vida.
- Los roles disponibles en PDTP siempre coinciden con el registry.
- Ninguna auditoría registra un estado anterior supuesto.

### Fase 6. Pruebas, migración y despliegue

Prioridad: obligatoria para cerrar cada fase.

1. Añadir pruebas unitarias de las invariantes y permisos.
2. Añadir pruebas de componentes para plantillas dinámicas, acciones móviles y
   reactivación.
3. Añadir un E2E corto por familia de catálogos: producto, flota y prevención.
4. Crear un verificador de calidad de datos de solo lectura con conteos de unidades no
   registradas, múltiples preferidos, flags divergentes, vencimientos faltantes y
   proveedores duplicados.
5. Generar cualquier cambio de esquema desde `db/schema/*.ts` con
   `npm run db:generate`; nunca editar el journal o una migración existente.
6. Verificar, por fase, pruebas focalizadas, ESLint, `npm run typecheck` y build antes
   del despliegue.

## Orden recomendado de entrega

1. Contrato unificado, componentes de composición y rutas canónicas.
2. Integración real de unidades y plantillas, más corrección de permisos de edición.
3. Invariantes de EPP y proveedor preferido.
4. Catálogo completo de vehículos dentro del mismo flujo y parámetros efectivos.
5. Identidad común de proveedores con una sola ficha de mantenimiento.
6. Adopción del contrato en SST/PDTP e importaciones masivas XLSX.

Este orden entrega valor sin exigir una reescritura y evita poblar nuevos catálogos
sobre contratos todavía incompletos.

## Roadmap de cierre de faltantes (2026-07-10)

Tras las Pasadas 1 a 3 quedan 8 tareas sueltas: Fase 0, Fase 2.3, Fase 2.5, Fase 3.8,
Fase 3.10, Fase 4, Fase 5 y Fase 6. Este roadmap las secuencia con base en el código real
(rutas verificadas), no en el orden original del documento.

**Estado actualizado después de las Pasadas 4 a 7:** la extracción de código de la Fase
0 ya fue adoptada por los seis catálogos; queda su checklist documental, navegación,
prueba de comportamiento y validación manual. La Fase 2.3 ya tiene identidad separada,
agrupación por `familyId` y normalizador aplicado localmente. La Fase 3.10 ya tiene alias
seguros y preservación de legacy; queda el reporte por entorno y la revisión de alias
adicionales. Permanecen como trabajo de implementación principal las Fases 2.5, 3.8, 4,
5 y 6.

**Cambio de orden respecto al "Orden recomendado de entrega" de arriba:** ese orden
ponía la Fase 0 primero como diseño previo. Las tres pasadas la saltaron deliberadamente
las tres veces, con razón: diseñar una composición compartida antes de tener
implementaciones reales era especulativo. Hoy ya no lo es. Seis catálogos — Faenas,
Trabajadores, Proveedores generales, Centros de costo, Productos y Vehículos —
convergieron **independientemente** al mismo esqueleto de lista y de formulario. La Fase
0 pasa de ser un diseño a ser una **extracción de código ya validado seis veces**, y por
eso se hace primero: desbloquea las Fases 3.8, 4 y 5.

### Patrón convergido que la Fase 0 extrae

Building blocks compartidos ya existentes: `components/admin/data-table.tsx`,
`components/admin/sheet.tsx` (`Sheet`, `SheetContent/Header/Body/Footer/Title`),
`components/admin/submit-button.tsx`, `components/admin/form-state.ts`
(`INITIAL_STATE`, `ActionState`), `components/ui/field.tsx`,
`components/ui/confirm-dialog.tsx`, `components/ui/page-header.tsx`,
`components/ui/page-container.tsx`, `components/ui/summary-bar.tsx`. La búsqueda del
TopBar se cablea solo declarando `searchKeys={[...]}` en `DataTable`
(`components/layout/header-context.tsx` → `top-bar.tsx` → `data-table.tsx`) — cero
código local por catálogo.

El esqueleto de **lista** es idéntico en los 6: `useActionState(toggleXActive)` + toast,
`useState` de `sheetOpen`/`editRow`, columnas con Estado (`Badge`) y acciones,
`<DataTable>` con `searchKeys`/`actions`/`renderRow`/`renderMobileCard`, y una celda de
acciones con botón Editar + `<form action={toggle}>` con `id`/`activate` ocultos.
Referencia: `app/(app)/admin/faenas/faenas-list.tsx`.

El esqueleto de **formulario** es idéntico: `useActionState(isEdit?update:create)` +
toast + `onClose`, `<Sheet>`→`<SheetContent>`→`<form>` con id oculto,
Header/Body(`FieldGroup`)/Footer (Cancelar + `SubmitButton`). Referencia simple:
`app/(app)/admin/faenas/worksite-form.tsx`; referencia con pestañas:
`app/(app)/admin/productos/product-form.tsx`.

Divergencias conocidas a **parametrizar, no borrar**: Productos usa pestañas más
`variant="sheet"|"embedded"` (`product-route-sheet.tsx`) y carga diferida
(`getProductForEdit`); Vehículos vive fuera de `admin/`
(`app/(app)/combustibles/vehiculos/`) y su desactivar usa `ConfirmDialog`; Centros de
costo nombra su acción `setCostCenterActiveAction` (los demás `toggleXActive`) y no
tiene `renderMobileCard`. Acción de toggle de referencia:
`app/(app)/admin/faenas/actions.ts` (forma `(_prev, formData) → {ok,message}`, lee `id` +
`activate === "true"`).

### 1. Fase 0 — extraer el contrato compartido de catálogos

- **Objetivo:** una composición `CatalogList` + `CatalogFormSheet` extraída de los 6
  catálogos conformes, sin motor CRUD genérico.
- **Enfoque:** extraer el esqueleto de lista (base `faenas-list.tsx`) a un componente que
  reciba `columns`, `searchKeys`, `toggleAction`, `renderForm`; y el esqueleto de
  formulario (base `worksite-form.tsx`) a un `CatalogFormSheet` que envuelva
  Sheet/Header/Body/Footer + `SubmitButton`. Las 3 divergencias conocidas se vuelven props
  opcionales, no se reescriben. Migrar primero Faenas y Trabajadores como prueba de la
  abstracción; los demás catálogos la adoptan al pasar por sus propias fases.
- **Prueba de contrato:** por cada catálogo registrado, verificar columna Estado,
  `searchKeys` presentes, acción de reactivar y `renderMobileCard`.
- **Cierre:** Faenas y Trabajadores usan la composición; test de contrato verde; sin
  regresión visual.

### 2. Fase 2.3 — `familyId` como identidad real de familia EPP

- **Objetivo:** que la identidad de familia excluya atributos de variante y que la lista
  agrupe por `familyId`.
- **Enfoque:** `db/schema/products.ts` ya tiene `familyId` (FK a `eppProductFamilies`,
  nullable) y esa tabla ya tiene `identityKey` único. El problema es que
  `identityKey()` en `lib/services/epp-import.types.ts` incluye hoy los atributos de
  variante (Talla/Color), así que cada variante termina siendo su propia "familia".
  Separar un `familyIdentityKey` (categoría + nombre canónico + marca + modelo, sin
  atributos) del `identityKey` de variante; hacer que `resolveFamily` use el de familia.
  Setear `familyId` en el formulario manual (`app/(app)/admin/productos/actions.ts`
  create/update), que hoy nunca lo toca y lo deja en `NULL`. Migrar
  `lib/products/variant-grouping.ts` (agrupa hoy por nombre normalizado, ignorando
  `familyId`) para agrupar por `familyId` con fallback a nombre normalizado en
  heredados `NULL`. Ejecutar antes un script de normalización revisable (dry-run) que
  reporte qué productos se re-agruparían antes de backfillear `familyId`.
- **Cierre:** toda variante nueva queda ligada a una familia explícita; heredados
  marcados para revisión; la lista agrupa por familia real.

### 3. Fase 3.10 — normalizar tipos heredados de vehículo

- **Objetivo:** catálogo o alias de `type` sin impedir editar valores antiguos.
- **Enfoque:** `type` es texto libre a propósito
  (`db/schema/fuel-vehicles.ts`, comentario en `lib/combustibles/validation.ts`) porque
  el catálogo real tiene ~17 valores libres sembrados que no calzan con la lista
  canónica de 13 (`FUEL_VEHICLE_TYPES`). Crear una tabla de alias (valor libre → tipo
  canónico) o columna de mapeo; el `<Select>` ofrece los canónicos y conserva el valor
  libre actual como opción heredada señalizada, igual que se hizo con las unidades
  heredadas de Producto en la Pasada 1. Migración de datos revisable, sin `check` duro
  sobre la columna.
- **Cierre:** vehículos heredados siguen editables; los nuevos eligen un tipo canónico;
  reporte de valores fuera de catálogo.

### 4. Fase 3.8 — `/admin/flota-catalogos` como agrupador

- **Objetivo:** que no introduzca un segundo modelo de navegación.
- **Enfoque:** `/admin/flota-catalogos/page.tsx` ya es una card del hub único
  `/admin/page.tsx` (grupo control-operacional), no un hub paralelo, y
  `catalog-links.tsx` ya filtra por permiso real. Falta apuntar sus enlaces a las
  superficies canónicas de administración una vez que Vehículos y Proveedores de
  combustible adopten la composición de la Fase 0 — por eso esta tarea va después de
  esa fase, para decidir la forma final sobre un contrato ya existente.
- **Cierre:** ningún enlace termina en `/forbidden`; una sola forma de llegar a cada
  catálogo.

### 5. Fase 4 — identidad de proveedores

- **Objetivo:** `fuel_suppliers` enlazado a `suppliers`, una sola ficha de identidad.
- **Enfoque:** `suppliers` (`db/schema/worksites.ts`) y `fuel_suppliers`
  (`db/schema/fuel-suppliers.ts`) están hoy totalmente disjuntas, sin FK. ADR que
  recomiende conservar `fuel_suppliers` especializado (por sus relaciones financieras)
  pero con FK `supplierId` obligatoria a `suppliers`, compartiendo identidad, RUT y
  contacto. Migración que vincule por RUT ya existente. Migrar la UI de combustible
  (`app/(app)/combustibles/proveedores-combustible/`, hoy un `<Table>` plano con 2
  diálogos y sin buscar/reactivar — `deleteFuelSupplierAction` solo desactiva) al
  `CatalogList`/`CatalogFormSheet` de la Fase 0. Usar como referencia de
  toggle+auditoría bidireccional `toggleSupplierActive` en
  `app/(app)/admin/proveedores/actions.ts`, que el maestro general ya implementa bien.
- **Cierre:** un mismo RUT no representa dos identidades; combustible conserva sus
  relaciones contables; la desactivación es reversible con permiso.

### 6. Fase 5 — homogeneizar SST y PDTP

- **Objetivo:** mismo ciclo de vida y auditoría real que el resto de catálogos.
- **Enfoque:** (a) Taxonomía SST (`app/(app)/admin/taxonomia-sst/taxonomy-list.tsx`) ya
  usa `DataTable`, pero duplica el CTA de creación (header de sección + prop `actions`
  del `DataTable` + `emptyAction`); dejar solo la del `DataTable`. (b) PDTP
  (`app/(app)/admin/pdtp-catalogos/`) tiene `ROLE_OPTIONS` hardcodeado en
  `sheet-form.tsx`; reemplazarlo por `loadAdminRoleSlugsAction()`, ya expuesto en
  `actions.ts` y respaldado por `listRoleSlugs()` en
  `lib/services/pdtp/admin-catalogs.ts`, que ya deriva del registry real. Añadir
  archivar/desactivar a responsables y hojas PDTP (hoy no existe), sin borrar los ya
  referenciados por programas. (c) La auditoría del toggle en
  `app/(app)/admin/taxonomia-sst/actions.ts` infiere el estado anterior como el opuesto
  del solicitado (`oldState: { isActive: !activate }`) en vez de leer el `isActive` real
  de la fila antes de mutar; corregirlo a una lectura previa.
- **Cierre:** los roles disponibles en PDTP siempre coinciden con el registry; ninguna
  auditoría registra un estado anterior supuesto; SST y PDTP tienen activar/desactivar
  reversible.

### 7. Fase 2.5 — XLSX de mantenimiento para productos/proveedores/trabajadores

- **Objetivo:** import/export XLSX con el mismo contrato de lote que EPP. Nunca CSV.
- **Enfoque:** reusar el patrón de lote revisable de `lib/services/epp-import.ts`
  (`stageEppImportXlsx` → previsualización → errores por fila → confirmar) y
  `lib/reports/export-module/excel-builder.ts` / `exceljs` para la escritura del sheet.
  Se ubica deliberadamente **después de la Fase 4**: importar proveedores antes de
  resolver su identidad sería construir sobre datos ambiguos.
- **Cierre:** cada entidad tiene importación previsualizable y exportación XLSX;
  decisión crear/actualizar/omitir por fila con resumen auditable.

### 8. Fase 6 — transversal: pruebas, verificador y falla suelta

- **Objetivo:** cerrar cada fase con pruebas y un verificador de calidad de datos de
  solo lectura.
- **Enfoque:** E2E corto por familia de catálogos (producto, flota, prevención) bajo
  `e2e/`, sobre la configuración ya existente (`playwright.config.ts`,
  `scripts/run-e2e.sh`). Verificador read-only en `scripts/` con conteos de unidades no
  registradas, múltiples preferidos, flags EPP/Prevención divergentes, vencimientos
  faltantes y proveedores duplicados por RUT. Arreglar la falla preexistente y no
  relacionada de `scripts/capture-all-routes.test.ts`, que no cubre
  `/admin/productos/importar/[batchId]` — agregarla a `dynamicSamples` en el test y como
  destino de captura en `scripts/capture-all-routes.ts`. Cualquier cambio de esquema
  sigue yendo por `npm run db:generate`, nunca editando el journal o una migración
  existente.
- **Cierre:** E2E verde por familia de catálogos; verificador ejecutable; suite completa
  sin la falla preexistente.

Cada tarea de este roadmap sigue su propio ciclo spec → plan → código, como las Pasadas
1 a 3 — este roadmap ordena el trabajo pendiente, no lo implementa.

### Pasada 4 — Fase 0: primitivas compartidas de catálogo (2026-07-10)

Implementa la tarea 1 del roadmap: extrae el boilerplate idéntico ya convergido en
Faenas y Trabajadores a primitivas compartidas, sin introducir un motor CRUD genérico.

Implementado:

- **`components/admin/use-catalog-sheet.ts`**: hook `useCatalogSheet<T>(toggleAction)`
  que centraliza el estado repetido de cada lista — `sheetOpen`/`editRow`, el
  `useActionState(toggleAction)` y el `useEffect` de toast según `ok`/`message`.
  Reemplaza las ~12 líneas idénticas al inicio de `faenas-list.tsx` y `worker-list.tsx`.
- **`components/admin/catalog-row-actions.tsx`**: `CatalogRowActions`, la celda de
  Editar + Activar/Desactivar que era byte-por-byte idéntica en ambos catálogos (botón
  `PencilSimple` + `<form>` con `id`/`activate` ocultos y `ToggleRight`/`ToggleLeft`).
  Renderiza solo los dos botones como fragment; cada lista conserva su propio contenedor
  (la celda de escritorio y la tarjeta móvil tienen wrappers distintos). De paso quedó
  unificado el vocabulario de accesibilidad: el botón Editar de escritorio de Faenas no
  tenía `aria-label` con el nombre de la entidad (solo la versión móvil lo tenía); ahora
  las 4 combinaciones (Faenas/Trabajadores × escritorio/móvil) usan el mismo patrón
  `aria-label={"Editar " + label}` / `"{Activar|Desactivar} " + label`.
- **`components/admin/catalog-form-sheet.tsx`**: `CatalogFormSheet`, el andamiaje de
  formulario (Sheet + `useActionState` que alterna `create`/`update` + toast + `onClose`
  + Header/Body/Footer con Cancelar y `SubmitButton`). Los campos entran por render-prop
  (`children: (state) => ReactNode`), así cada formulario sigue dueño de su
  `FieldGroup` y de su lógica local (por ejemplo el auto-código de Faena).
- **`components/admin/catalog-contract.test.ts`**: prueba de contrato de metadata pura
  (sin RTL, mismo criterio de las Pasadas 1–3). Cada lista migrada exporta
  `CONTRACT = { name, columns, searchKeys }`; el test itera un arreglo de contratos y
  verifica `searchKeys` no vacío, columna Estado (`key: "isActive"`) y columna de
  acciones (`key: ""`).
- **Migración piloto**: `faenas-list.tsx`/`worksite-form.tsx` y
  `worker-list.tsx`/`worker-form.tsx` reescritos sobre las primitivas. `DataTable`,
  columnas y celdas primarias se conservan intactos; no hay cambios de esquema, permisos
  ni server actions — las acciones `create/update/toggle` existentes se reutilizan tal
  cual.

Verificación de la pasada:

- `npx vitest run components/admin/catalog-contract.test.ts`: 6/6 pruebas.
- `npx vitest run lib/__tests__/faenas-actions.test.ts lib/__tests__/trabajadores-actions.test.ts components/admin/catalog-contract.test.ts`: 31/31 pruebas.
- `npm run typecheck -- --pretty false`: correcto.
- `npx eslint` sobre los 8 archivos (4 nuevos + 4 modificados): sin hallazgos.
- `npx vitest run` (suite completa, 245 archivos): 2243/2244 pruebas pasan. La única
  falla es la misma preexistente y no relacionada reportada al cierre de la Pasada 2
  (`scripts/capture-all-routes.test.ts`, falta `/admin/productos/importar/[batchId]` en
  el inventario de rutas). Ningún cambio de esta pasada introdujo regresiones.
- **No se hizo la verificación funcional en navegador** (crear/editar/buscar/
  desactivar/reactivar en `/admin/faenas` y `/admin/trabajadores`) — el usuario pidió
  explícitamente saltarla en esta pasada. Queda como pendiente suelto antes de dar la
  Fase 0 por validada en release, igual que la revisión visual/funcional que la Fase 1
  dejó pendiente en la Pasada 1.

Faltante al terminar esta pasada:

- **Verificación funcional en navegador** de Faenas y Trabajadores (ver arriba):
  explícitamente no ejecutada en esta pasada.
- **Migrar los 4 catálogos restantes** (Productos, Vehículos, Proveedores generales,
  Centros de costo) a `CatalogRowActions`/`CatalogFormSheet`/`useCatalogSheet` y sumar su
  `CONTRACT` al test — ocurre al pasar cada uno por su propia fase del roadmap (3.8, 4,
  5). Ninguno se tocó en esta pasada.
- **Props de divergencia no agregadas todavía**: `CatalogRowActions` no tiene una
  variante con `ConfirmDialog` (la necesita Vehículos al migrar) ni `CatalogFormSheet`
  soporta pestañas ni el `variant="sheet"|"embedded"` de Productos. Se añadirán como
  props opcionales cuando esos catálogos migren, no antes — evita diseñar la
  parametrización sin un segundo caso de uso real que la valide.
- **Puntos 1, 5 y 6 de la Fase 0 original** (checklist de sistema de diseño, vocabulario
  unificado a nivel de toda la app, rutas canónicas/redirecciones) no se abordaron: esta
  pasada fue la extracción de código (punto 2–4 y 7), no la documentación ni el trabajo
  de rutas, que dependen de que más catálogos migren primero.
- El resto del roadmap (tareas 2 a 8: `familyId`, tipos heredados de vehículo, agrupador
  de flota, identidad de proveedores, SST/PDTP, XLSX de mantenimiento, transversal) sigue
  pendiente sin cambios.

### Pasada 5 — Fase 0: adopción del contrato en los seis catálogos (2026-07-10)

Implementado:

- **`CatalogFormSheet` ampliado**: ahora soporta las variantes `sheet` y `embedded`,
  campos ocultos, clases específicas para cuerpo/pie y estado/acción externos. Esto
  permite que Productos conserve sus pestañas y su payload dinámico sin duplicar el
  andamiaje de Sheet, formulario, toast y acciones Guardar/Cancelar.
- **`CatalogRowActions` ampliado**: centraliza Editar y Activar/Desactivar para los seis
  listados, admite estado pendiente y permite que Vehículos mantenga su confirmación
  previa al desactivar.
- **`useCatalogSheet` ampliado**: expone el estado pendiente del toggle además del
  estado de apertura, fila editada y acción de cambio de estado.
- **Migración de listas**: Productos, Vehículos, Proveedores y Centros de costo ahora
  usan las primitivas compartidas; Faenas y Trabajadores ya las usaban desde la Pasada
  4. Centros de costo incorpora además representación móvil consistente.
- **Migración de formularios**: Productos, Vehículos, Proveedores y Centros de costo
  usan `CatalogFormSheet`; se conservaron como variaciones de dominio las pestañas de
  Productos/Vehículos, el editor embebido de Productos y el enlace de documentos de
  Vehículos.
- **Contrato separado de Fast Refresh**: columnas y metadata de cada catálogo viven en
  `catalog-contract.ts`, fuera de los archivos de componentes. El test de contrato ahora
  cubre seis catálogos y verifica búsqueda, columna Estado, acciones y representación
  móvil.

Verificación de la pasada:

- `npx vitest run components/admin/catalog-contract.test.ts app/(app)/admin/productos/product-form.helpers.test.ts lib/__tests__/admin-productos.test.ts lib/__tests__/admin-product-catalogs-actions.test.ts lib/__tests__/validation-masters.test.ts app/(app)/combustibles/actions-vehicles.test.ts`: **107/107 pruebas**.
- `npm run typecheck -- --pretty false`: correcto.
- ESLint focalizado sobre los componentes y catálogos modificados: sin errores; se
  corrigieron los avisos introducidos por metadata no utilizada.
- `git diff --check`: correcto.
- React Doctor `--scope changed`: no se deben introducir exports no-componentes desde
  archivos React; el diagnóstico todavía reporta 14 advertencias fuera del alcance de
  esta pasada, incluidos otros archivos y el tamaño de `ProductForm`/`ProductList`,
  que quedan para una pasada de calidad separada.

Faltante al terminar esta pasada:

- **Fase 0 documental y de navegación**: falta formalizar el checklist de diseño, el
  vocabulario global y las rutas canónicas/redirecciones.
- **Prueba de contrato aún metadata-only**: no verifica el comportamiento renderizado
  real de TopBar, móvil, activación ni formularios. Faltan pruebas de componente y la
  validación manual en navegador de los seis recorridos.
- **Fase 2.3**: identidad `familyId`, normalización revisable y agrupación real de
  variantes EPP.
- **Fase 2.5**: mantenimiento XLSX de Productos, Proveedores y Trabajadores.
- **Fase 3.8/3.10**: decisión final del agrupador de flota, enlaces canónicos y
  catálogo/alias de tipos de vehículo.
- **Fase 4**: identidad común entre proveedores generales y de combustible, migración
  por RUT y reactivación/auditoría del catálogo de combustible.
- **Fase 5**: SST/PDTP, roles dinámicos, archivo de responsables/hojas y auditoría del
  estado anterior real.
- **Fase 6**: E2E por familia, verificador read-only de calidad de datos y corrección de
  la captura faltante de `/admin/productos/importar/[batchId]`.
- Sigue pendiente la verificación visual/funcional en navegador antes de considerar
  esta fase validada para release.

### Pasada 6 — Fase 2.3: identidad canónica de familias EPP (2026-07-10)

Implementado:

- `NormalizedEppRow` ahora conserva dos identidades: `identityKey` incluye atributos
  de variante y `familyIdentityKey` usa solo categoría, nombre canónico, marca y
  modelo. Talla, Color y otros atributos ya no crean familias distintas durante la
  importación.
- `confirmEppImportBatch` resuelve familias usando `familyIdentityKey`, manteniendo
  separadas las variantes en sus atributos de producto.
- El alta y edición manual de Productos crea o reutiliza una familia EPP cuando
  `isEpp` está activo y limpia `familyId` cuando deja de ser EPP.
- El listado de Productos agrupa primero por `familyId` y conserva fallback por nombre
  normalizado para registros heredados que aún no tengan familia.
- Se agregó `scripts/normalize-epp-families.ts`, con modo seguro DRY-RUN por defecto y
  `--apply` explícito, además de `npm run db:normalize-epp-families`. El proceso reporta
  colisiones, productos sin familia y reasigna productos a una familia ganadora sin
  borrar historia operativa.

Verificación de la pasada:

- Pruebas EPP, agrupación y formulario: **32/32**.
- `npm run typecheck -- --pretty false`: correcto.
- Dry-run antes del backfill local: 0 familias, 53 productos EPP sin familia y 0
  colisiones.
- Backfill aplicado solo contra la base local de `.env.local`; dry-run posterior:
  **52 familias, 0 productos EPP sin familia, 0 colisiones**.

Faltante al terminar esta pasada:

- El backfill debe ejecutarse de forma controlada en cada entorno de despliegue; no se
  aplicó a producción.
- Falta validación visual/funcional del selector de familias y variantes en el listado,
  además de un E2E que compruebe importar dos variantes y verlas bajo una familia.
- Los productos manuales no tienen campos separados de marca/modelo; cuando el negocio
  requiera esa identidad desde el formulario habrá que ampliar el modelo de captura.
- Permanece pendiente el resto de la Fase 2: mantenimiento XLSX y advertencias a nivel
  de familia para variantes mixtas.

### Pasada 7 — Fase 3.10: catálogo y alias seguros para tipos de vehículo (2026-07-10)

Implementado:

- Se agregó un catálogo de alias explícitos para valores heredados seguros como
  `tractocamion`, `mini cargador`, `retro excavadora`, `hidro lavadora`, `station wagon`
  y `camion 3/4`.
- `canonicalFuelVehicleType` permite reconocer el tipo canónico sin convertir la columna
  libre en un enum destructivo.
- El formulario sigue permitiendo editar valores desconocidos y muestra los alias con
  su equivalente canónico; los nuevos registros continúan usando las opciones
  canónicas.
- La tabla usa el mismo formateador para mostrar tipos heredados y canónicos.
- Se añadieron pruebas de alias y de preservación de valores fuera del catálogo.

Verificación de la pasada:

- Pruebas de tipos de vehículo y acciones: **10/10**.
- `npm run typecheck -- --pretty false`: correcto.
- La suite completa se inició y volvió a mostrar la falla conocida del inventario de
  capturas (`/admin/productos/importar/[batchId]`), pero el runner quedó sin progreso
  durante varios minutos y se detuvo por timeout operativo; el cierre completo de la
  suite queda pendiente junto con Fase 6.

Faltante al terminar esta pasada:

- Falta ejecutar un reporte de valores de `fuel_vehicles.type` en cada entorno y decidir
  manualmente alias adicionales que no sean inequívocos.
- No se normalizan automáticamente los valores heredados en la base; se conservan para
  no alterar datos sin revisión humana.
- Siguen pendientes Fases 3.8, 4, 5 y 6, además de la validación de navegador de las
  pasadas anteriores.

### Pasada 8 — Fase 4: identidad común de proveedores (2026-07-10)

Implementado:

- `fuel_suppliers` ahora tiene la relación opcional `supplier_id` hacia el maestro
  general `suppliers`, con `on delete set null`. La migración generada por Drizzle es
  `0038_conscious_shooting_star.sql`; se aplicó únicamente contra la base local.
- Las acciones de combustible crean o reutilizan la identidad general, resuelven RUT
  aunque venga con formatos equivalentes (`12.345.678-9` frente a `12345678-9`),
  rechazan un RUT que ya pertenezca a otra identidad seleccionada y mantienen los datos
  comerciales sincronizados entre ambos registros.
- El catálogo de proveedores de combustible migró al mismo contrato que los otros
  maestros: `DataTable`, búsqueda del TopBar, orden, paginación, estado activo/inactivo,
  reactivación, confirmación de desactivación, vista móvil y `CatalogFormSheet`.
  El formulario permite seleccionar una identidad general existente o crear/resolver una
  por RUT; las identidades generales inactivas siguen disponibles para editar relaciones
  históricas sin duplicarlas.
- La desactivación es reversible, conserva cargas/facturas y registra auditoría con el
  estado anterior y posterior. `deleteFuelSupplierAction` queda como compatibilidad para
  consumidores antiguos y delega en el nuevo toggle.
- Se agregó `scripts/normalize-fuel-suppliers.ts` y el comando
  `npm run db:normalize-fuel-suppliers`. Es DRY-RUN por defecto; `--apply` solo enlaza
  coincidencias únicas por RUT. Las coincidencias únicamente por nombre, ambiguas y sin
  coincidencia se reportan para revisión y no se fusionan automáticamente.

Verificación de la pasada:

- `npm run db:migrate`: correcto; migración `0038` aplicada localmente.
- `npm run db:generate`: posterior a la migración indicó `No schema changes, nothing to
  migrate`.
- `npm run db:normalize-fuel-suppliers`: DRY-RUN local con 0 proveedores de combustible,
  0 vínculos pendientes y 0 cambios aplicables. No se escribió ningún dato de producción.
- Pruebas focalizadas de acciones, contratos de catálogo y vehículos: **44/44**.
- `npm run typecheck -- --pretty false`: correcto.
- ESLint focalizado sobre acciones, página, formulario, tabla y normalizador: correcto.
- React Doctor `--scope changed`: **71/100**, 14 advertencias ya existentes en otras
  superficies de Combustibles/Admin; no señaló los nuevos componentes del catálogo de
  proveedores de combustible.

Faltante al terminar esta pasada:

- **Backfill por entorno**: la herramienta existe, pero debe ejecutarse primero en DRY-RUN
  y luego con `--apply` en cada base objetivo, revisando manualmente coincidencias por
  nombre, ambigüedades y proveedores sin RUT. No se ejecutó en producción.
- **Validación de navegador**: falta recorrer crear, editar, buscar, desactivar y
  reactivar en los seis/siete catálogos migrados, incluido el vínculo de proveedor
  general en `/combustibles/proveedores-combustible`.
- **Fase 0 documental y de navegación**: falta cerrar checklist del sistema de diseño,
  vocabulario global, permisos visibles y rutas canónicas desde `/admin`; todavía existe
  la decisión pendiente sobre el hub canónico de flota y los enlaces operacionales.
- **Fase 0 de pruebas**: el contrato actual verifica metadata; faltan pruebas de
  componente/E2E para TopBar, móvil, formularios, activación, reactivación y permisos.
- **Fase 2.5**: falta el mantenimiento masivo XLSX de Productos, Proveedores y
  Trabajadores con selección, previsualización, errores por fila, crear/actualizar/omitir,
  confirmación y resumen auditable.
- **Fase 2.4 restante**: falta decidir y mostrar advertencias agregadas a nivel de familia
  cuando las variantes EPP tengan requisitos mixtos; también queda la ampliación de
  marca/modelo en el formulario manual si el negocio lo exige.
- **Fase 3.8**: falta cerrar el agrupador/hub canónico de flota, conectar sus enlaces a
  rutas de administración y filtrar enlaces por permiso antes de considerar resuelto el
  acceso desde `/admin`.
- **Fase 3.10 restante**: falta reportar `fuel_vehicles.type` en cada entorno y revisar
  alias adicionales; no se normalizaron automáticamente los valores heredados.
- **Fase 5**: faltan la unificación de catálogos SST/PDTP bajo el patrón común, roles
  dinámicos desde el registro real, activación/archivo de responsables y hojas, y
  auditoría que capture el estado anterior real en sus acciones.
- **Fase 6**: falta el verificador read-only de calidad de datos, E2E por familia de
  catálogos, captura visual funcional y corregir el inventario/ruta faltante de
  `/admin/productos/importar/[batchId]` en `scripts/capture-all-routes.ts`.
- **Release**: falta ejecutar pruebas visuales y de navegador con datos representativos,
  aplicar backfills/migraciones de forma controlada en los entornos de despliegue y
  completar la verificación operativa posterior. La suite completa sigue teniendo la
  falla conocida de captura y el timeout operativo documentado en la Pasada 7.

### Pasada 9 — Backfill, validación funcional y rutas canónicas de flota (2026-07-11)

Implementado:

- Se auditó la disponibilidad de entornos. Este checkout solo tiene configurado
  `.env.local`; staging/producción dependen de secretos externos (`PRODUCTION_DATABASE_URL`)
  y no son accesibles desde esta sesión. Se dejó el procedimiento reproducible en
  `docs/deploy/RUNBOOK.md` con orden de pruebas/restauración, staging y producción,
  backup previo y revisión antes de `--apply`.
- Se ejecutó el DRY-RUN del backfill en la base local: 0 proveedores de combustible,
  0 coincidencias, 0 ambiguos y 0 sin coincidencia. No hubo datos que modificar.
- Se ejecutó el DRY-RUN contra la base E2E desechable: 2 proveedores de combustible,
  1 ya vinculado, 0 coincidencias seguras adicionales y 1 sin coincidencia
  (`fuel-sup-e2e`, con RUT `76.111.222-3`). El caso quedó reportado para revisión manual;
  no se aplicó ningún vínculo por nombre ni se fabricó una identidad general.
- Se cerraron las rutas canónicas administrativas de flota:
  `/admin/flota-catalogos/vehiculos` y
  `/admin/flota-catalogos/proveedores-combustible`. Las rutas operacionales antiguas
  redirigen a ellas, por lo que no existen dos superficies de edición.
- `/admin/flota-catalogos` quedó como agrupador único de flota y sus enlaces apuntan a
  las superficies canónicas. Se corrigió el permiso de proveedores de combustible para
  usar `combustibles:manage_suppliers`; antes heredaba incorrectamente
  `combustibles:manage_vehicles`.
- Se extrajo la carga server-side de vehículos y proveedores a componentes compartidos,
  evitando duplicar CRUD entre las rutas legacy y las canónicas. También se actualizaron
  revalidación, enlace desde `/flota`, inventario de capturas y pruebas de compatibilidad.
- Se corrigió una falla de build real del hub: `CatalogLinks` usaba el entrypoint cliente
  de Phosphor desde un Server Component y provocaba `createContext is not a function`.
  Ahora usa el entrypoint SSR.
- Se agregó `e2e/catalogs-migrated.spec.ts`, que cubre ocho rutas administrativas,
  búsqueda del TopBar, hub canónico y ciclos editar/desactivar/reactivar de vehículos y
  proveedores. Se completó también la expectativa legacy del módulo de combustibles.

Verificación de la pasada:

- Suite E2E administrativa de catálogos: **4/4**.
- Módulo E2E de Combustibles: **9/10** en la primera ejecución; la única falla fue una
  expectativa obsoleta de columna (`Nombre`). Tras actualizarla a `Proveedor` y afirmar
  la redirección canonical, la prueba específica legacy pasó **1/1**. Los otros 9 flujos
  ya habían pasado en esa misma ejecución.
- `npx vitest run` focalizado: **48/48**.
- `npm run typecheck -- --pretty false`: correcto.
- ESLint sobre los archivos implementados y pruebas: sin errores; el único aviso fue que
  `docs/deploy/RUNBOOK.md` no es un archivo cubierto por la configuración ESLint.
- React Doctor: **71/100**, las mismas 14 advertencias preexistentes en superficies de
  Combustibles/Admin; no aparecieron advertencias nuevas en el hub o catálogos canónicos.
- La compilación que ejecuta Playwright pasó después del ajuste SSR y permitió completar
  la suite funcional. No se tocó producción.

Faltante al terminar esta pasada:

- **Backfill real de staging/producción**: faltan las credenciales y autorización operativa
  para ejecutar `DATABASE_URL=... npm run db:normalize-fuel-suppliers -- --apply` en cada
  entorno. El procedimiento está documentado, pero la ejecución real sigue pendiente.
- **Revisión manual E2E**: `fuel-sup-e2e` no tiene una identidad general con el mismo RUT;
  debe decidirse si se crea/enlaza manualmente antes de aplicar un backfill equivalente.
- **Validación funcional completa de cada catálogo**: el navegador comprobó navegación y
  el ciclo completo en flota/proveedores; falta repetir crear/editar/desactivar/reactivar
  individualmente en Faenas, Trabajadores, Proveedores generales, Productos y Centros de
  costo, además de comprobar permisos con roles restringidos.
- **Fase 0 documental**: falta terminar checklist de diseño, vocabulario transversal y
  contrato de permisos/estados para toda la app.
- **Fase 2.5**: mantenimiento masivo XLSX para Productos, Proveedores y Trabajadores.
- **Fase 2.4 restante**: advertencias agregadas por familia EPP y decisión de marca/modelo
  en alta manual.
- **Fase 3.10 restante**: reporte de tipos heredados de vehículos por entorno y revisión
  de alias adicionales; todavía no se normalizan automáticamente.
- **Fase 5**: homogeneización SST/PDTP, roles dinámicos, archivo de responsables/hojas y
  auditoría de estado anterior real.
- **Fase 6**: verificador read-only, E2E por familia fuera de catálogos migrados,
  capturas visuales completas y corrección de la ruta pendiente de captura
  `/admin/productos/importar/[batchId]`.
- **Release**: ejecutar el backfill aprobado, verificar salud posterior en cada entorno y
  cerrar la suite completa del repositorio, que mantiene la falla/timeout de captura
  documentada en pasadas anteriores.

### Pasada 10 — Fase 5 completa + verificador + captura de rutas (2026-07-11)

Implementado:

- **Fase 5.1 — SST: CTAs duplicados eliminados**: `taxonomy-list.tsx` tenía 6 botones de
  creación (3 por categoría + 3 por tipo: encabezado de sección, `emptyAction` y `actions`
  del `DataTable`). Se removieron los botones del encabezado de sección, manteniendo solo
  `emptyAction` (estado vacío) y `actions` (barra de herramientas con datos). El botón
  "Sembrar predeterminadas" se conserva en el encabezado de categorías como acción
  independiente. Cierra el diagnóstico 5 "Taxonomía SST muestra el CTA de creación
  duplicado".

- **Fase 5.2 — SST: auditoría con estado anterior real**: `setDocumentCategoryActive` y
  `setDocumentTypeActive` en `lib/services/prevention-documents/taxonomy.ts` ahora leen el
  `isActive` real de la fila antes de mutar y retornan `{ row, previousIsActive }`. Las
  acciones de toggle en `actions.ts` usan `previousIsActive` en lugar de inferir
  `!activate`. Actualizados los tests existentes para verificar `oldState` y `newState`.
  Cierra el criterio "Ninguna auditoría registra un estado anterior supuesto" para SST.

- **Fase 5.3 — PDTP: roles dinámicos desde el registry**: `sheet-form.tsx` eliminó el
  array hardcodeado `ROLE_OPTIONS` (11 slugs). Ahora `page.tsx` carga los slugs desde
  `listRoleSlugs()` (que deriva del registry real) y los pasa como prop `roleOptions` a
  través de `CatalogTabs → SheetForm`. El formulario usa `roleOptions` en lugar del
  hardcodeo. Cierra el diagnóstico "La lista de roles de la UI está codificada".

- **Fase 5.4 — PDTP: activación/desactivación de responsables y hojas**:
  - Esquema: se agregó `isActive` (boolean, default `true`) a `pdtp_responsible_catalog`
    y `pdtp_sheets` en `db/schema/prevention/pdtp.ts`.
  - Migración: `db:generate` produjo `0039_complex_eternity.sql`. `db:migrate` aplicado
    localmente sin errores. `db:generate` posterior confirma "No schema changes".
  - Servicio: `setPdtpResponsibleActive(slug, isActive)` y `setPdtpSheetActive(id,
    isActive)` en `lib/services/pdtp/admin-catalogs.ts` leen el estado real y devuelven
    `{ row, previousIsActive }`, mismo patrón que el fix SST.
  - Acciones: `togglePdtpResponsibleActiveAction` y `togglePdtpSheetActiveAction` con
    permiso `admin:pdtp_catalog`, auditoría con estado real y revalidación.
  - UI: `catalog-tabs.tsx` ahora muestra columna Estado (`Badge` Activo/Inactivo) y
    botones toggle `ToggleRight`/`ToggleLeft` en las filas de responsables y hojas.
    `ResponsibleRow` y `SheetRow` incluyen `isActive: boolean`. `page.tsx` mapea el campo
    desde la base.
  - Cierra los diagnósticos "Faltan activación/archivo" y "PDTP permite editar pero no
    archivar o desactivar".

- **Fase 6.4 — Verificador de calidad de datos**: se creó `scripts/verify-data-quality.ts`,
  solo lectura, que reporta: productos con unidad fuera del maestro, flags
  EPP/Prevención divergentes, productos sin proveedor preferido, productos sin precio
  referencial, vehículos con vencimientos expirados o sin fechas, proveedores con RUT
  duplicados (generales), RUT divergentes entre general y combustible, proveedores de
  combustible sin vínculo general, familias EPP vacías, productos EPP sin `familyId`, y
  conteos de activos/inactivos en PDTP. Se ejecuta con
  `npx tsx scripts/verify-data-quality.ts`.

- **Fase 6.6 — Corrección de ruta de captura faltante**: se agregó
  `/admin/productos/importar/[batchId]` a `dynamicSamples` en
  `scripts/capture-all-routes.test.ts` con la muestra
  `/admin/productos/importar/batch-audit-1`, y el `RouteTarget` correspondiente en
  `scripts/capture-all-routes.ts`. Cierra la falla preexistente y no relacionada
  reportada desde la Pasada 2.

Verificación de la pasada:

- `npx vitest run` (10 archivos focalizados: SST actions, PDTP actions, productos,
  vehículos, validación, contrato de catálogo, captura de rutas): **143/143 pruebas**.
- `npx vitest run scripts/capture-all-routes.test.ts`: **2/2**, resuelve la falla
  preexistente.
- `npm run typecheck -- --pretty false`: correcto.
- `npm run db:generate` posterior a la migración: "No schema changes, nothing to migrate".
- `npx eslint` sobre los 10 archivos modificados/creados: sin hallazgos.

Faltante al terminar esta pasada:

- **Fase 0 documental**: falta formalizar checklist de diseño, vocabulario global y
  contrato de permisos/estados.
- **Fase 2.4 restante**: advertencias agregadas por familia EPP y decisión de marca/modelo
  en alta manual.
- **Fase 2.5**: mantenimiento masivo XLSX para Productos, Proveedores y Trabajadores.
- **Fase 3.10 restante**: reporte de tipos heredados de vehículos por entorno y revisión
  de alias adicionales.
- **Fase 6.3**: E2E por familia de catálogos fuera de catálogos migrados.
- **Fase 6.5**: capturas visuales completas (el inventario de rutas está completo pero
  la ejecución del script de captura requiere entorno dedicado).
- **Validación funcional**: falta recorrer crear/editar/buscar/desactivar/reactivar en
  navegador para todos los catálogos, y comprobar permisos con roles restringidos.
- **Release**: backfill de staging/producción, verificación de salud posterior.
- **Fase 5.5 descartada**: migrar PDTP a primitivas compartidas (`CatalogFormSheet`,
  `CatalogRowActions`) no se justifica — el `catalog-tabs.tsx` usa un layout de 3
  pestañas que es inherentemente distinto al patrón de lista única, y ya usa `DataTable`
  con `searchKeys`, `actions`, `emptyAction`, y el nuevo toggle compartido. El
  boilerplate es mínimo y su extracción introduciría más acoplamiento que beneficio.

### Pasada 11 — Fase 2.5 parcial: exportación XLSX de catálogos (2026-07-11)

Implementa la exportación XLSX para los tres catálogos principales. La importación
masiva con previsualización se pospone para una pasada posterior porque requiere
una superficie de UI nueva por entidad (paneles de carga, revisión por fila,
confirmación con crear/actualizar/omitir) — un trabajo comparable al importador EPP
pero para tres entidades distintas.

Implementado:

- **API route `/api/admin/catalogos/export`**: `GET` con parámetro `tipo` que acepta
  `productos`, `proveedores` y `trabajadores`. Cada tipo tiene su propio permiso
  (`admin:products`, `admin:suppliers`, `admin:workers`). La ruta usa `auth()` para
  autenticación y `canAny()` para autorización. Genera XLSX mediante
  `buildXlsxBuffer` de `@/lib/reports/export` con `exceljs`.

- **Exportación de Productos**: 11 columnas (ID, SKU, Nombre, Categoría, Descripción,
  Unidad, EPP, Prevención, Precio ref., Proveedores, Activo). Los proveedores se
  consolidan por producto en una sola celda (separados por `; `), con el preferido
  marcado `(preferido)`.

- **Exportación de Proveedores**: 13 columnas (ID, Nombre, RUT, Giro, Contacto, Email,
  Teléfono, Dirección, Comuna, Ciudad, Cond. pago, Activo, Notas).

- **Exportación de Trabajadores**: 9 columnas (ID, RUT, Nombre, Apellido, Cargo,
  Supervisor, Prevencionista, Faena, Activo). Faena se resuelve mediante `leftJoin`
  con `worksites`.

- **Botones de exportación en UI**: `product-list.tsx`, `supplier-list.tsx` y
  `worker-list.tsx` ahora incluyen un botón "Exportar XLSX" en la barra de acciones
  del `DataTable`. Usan un `<a>` nativo (con `eslint-disable-next-line`) porque
  `next/link` no es adecuado para descargas de archivos binarios desde API routes.

- **Pruebas**: `lib/__tests__/catalog-export-route.test.ts` con 6 casos que cubren
  autenticación (401), tipo inválido (400), permisos denegados por entidad (403),
  y tipo vacío (400).

Verificación de la pasada:

- `npx vitest run` (6 archivos focalizados): **75/75 pruebas**.
- `npm run typecheck -- --pretty false`: correcto.
- `npx eslint` sobre los 5 archivos modificados/creados: sin hallazgos.

Faltante al terminar esta pasada:

- **Fase 2.5 restante**: falta la importación masiva XLSX con previsualización por
  entidad (patrón: seleccionar archivo, mostrar errores por fila, decidir
  crear/actualizar/omitir, confirmar, resumen auditable). La exportación ya está lista y
  permite el flujo "exportar → editar offline → re-importar".
- **Fase 6.3**: E2E por familia de catálogos.
- **Fase 6.5**: capturas visuales completas.
- **Validación funcional**: recorrer crear/editar/buscar/desactivar/reactivar en navegador
  con roles restringidos.
- **Release**: backfill de staging/producción, verificación de salud posterior.

### Pasada 12 — Fase 0, Fase 2.4, Fase 3.10 (2026-07-11)

Cierra tres tareas deuda técnica: el checklist documental de la Fase 0, las
advertencias agregadas por familia EPP de la Fase 2.4 y el reporte de tipos heredados
de vehículo de la Fase 3.10.

Implementado:

- **Fase 0 documental**: se creó `docs/admin/catalogo-checklist.md` con el checklist
  obligatorio de catálogos. Cubre: vocabulario unificado (Nuevo, Editar, Guardar cambios,
  Activar, Desactivar, Reactivar, Activo, Inactivo, Sin resultados, Sin permisos), patrón
  de listado (12 ítems con checkboxes), patrón de formulario (11 ítems), ciclo de vida
  (6 ítems), auditoría (4 ítems), permisos (5 ítems), componentes compartidos (10
  componentes referenciados con su ruta), y prueba de contrato (6 ítems). Cada ítem es
  verificable (checkbox `[ ]`).

- **Fase 2.4 — advertencias por familia EPP**: se agregó `getFamilyWarnings()` en
  `product-list.helpers.ts` que agrega las advertencias de todas las variantes de una
  familia. Detecta específicamente "Familia con requisitos EPP mixtos entre variantes"
  cuando algunas variantes tienen atributos obligatorios y otras no (solo para familias
  con >1 variante). `product-list.tsx` ahora muestra un segundo ícono `Warning` junto al
  de variante para las advertencias de familia. Se añadieron 6 pruebas unitarias.

- **Fase 3.10 — reporte de tipos heredados de vehículo**: se creó
  `scripts/list-vehicle-types.ts`, script de solo lectura que consulta
  `fuel_vehicles.type`, clasifica cada valor como `[canónico]` (en `FUEL_VEHICLE_TYPES`),
  `[alias]` (en `FUEL_VEHICLE_TYPE_ALIASES`) o `[heredado]` (sin clasificación), y
  sugiere entradas de alias para los valores no clasificados. Se ejecuta con
  `npx tsx scripts/list-vehicle-types.ts`.

Verificación de la pasada:

- `npx vitest run` (7 archivos focalizados): **91/91 pruebas**.
- `npm run typecheck -- --pretty false`: correcto.
- `npx eslint` sobre los archivos modificados/creados: sin errores.

Faltante al terminar esta pasada:

- **Fase 2.5 import**: falta la importación masiva XLSX con previsualización.
- **Fase 6.3**: E2E por familia de catálogos.
- **Fase 6.5**: capturas visuales completas.
- **Validación funcional**: navegador con roles restringidos.
- **Release**: backfill de staging/producción.

### Pasada 13 — Fase 2.5 importación XLSX (2026-07-11)

Implementa la importación XLSX de mantenimiento para los tres catálogos principales.
Usa un patrón más simple que el importador EPP: dado que los archivos se generan desde
el botón "Exportar XLSX", ya contienen la columna ID y datos normalizados. No hay
normalización ni matching — solo crear (sin ID) o actualizar (con ID).

Implementado:

- **Servicio genérico `lib/services/catalog-import.ts`**: `parseCatalogWorkbook(buffer)`
  lee cualquier XLSX con ExcelJS, detecta headers desde la primera fila, mapea cada fila
  a `{ rowNumber, values, decision, existingId, error }`. Usa la columna "ID" para
  determinar `create` vs `update`. Límite de 10.000 filas.

- **Panel de importación compartido `components/admin/catalog-import-panel.tsx`**:
  `CatalogImportPanel` recibe `title`, `description`, `action` (server action) y
  `helperText`. Es un Sheet con input de archivo, `useActionState`, toast y resumen
  creados/actualizados/omitidos.

- **Acciones de importación por entidad**:
  - `importProductsFromXlsx` en `productos/actions.ts`: importa nombre, categoría,
    descripción, unidad, flags EPP/Prevención, precio y estado activo. Resuelve la
    categoría por nombre (crea si no existe).
  - `importSuppliersFromXlsx` en `proveedores/actions.ts`: importa los 13 campos
    del export de proveedores.
  - `importWorkersFromXlsx` en `trabajadores/actions.ts`: importa los 9 campos
    del export de trabajadores.

- **Botones en UI**: los tres catálogos (productos, proveedores, trabajadores) ahora
  tienen botón "Importar XLSX" que abre el `CatalogImportPanel`. En productos convive
  con el botón "Importar EPP" existente (el EPP usa el importador especializado).

Verificación de la pasada:

- `npx vitest run` (7 archivos focalizados): **91/91 pruebas**.
- `npm run typecheck -- --pretty false`: correcto.
- `npx eslint`: sin errores (1 warning de import no usado corregido).

Faltante al terminar esta pasada:

- **Fase 6.3**: resuelto — E2E de catálogos: 4/4 pruebas (ejecutado post-Pasada 13).
- **Fase 6.5**: resuelto — capturas visuales: 216/216 exitosas (ejecutado post-Pasada 13).
- **Validación funcional**: navegador con roles restringidos.
- **Release**: backfill de staging/producción.

### E2E de catálogos — verificación post-Pasada 13 (2026-07-11)

Se ejecutó `bash scripts/run-e2e.sh e2e/catalogs-migrated.spec.ts` que levanta un
contenedor Docker PostgreSQL, aplica migraciones, construye la app y corre Playwright.
Resultado: **4/4 pruebas pasan** (1.8 min).

- Todos los catálogos administrativos tienen ruta navegable: faenas, trabajadores,
  proveedores, centros de costo, productos, catálogos de productos, vehículos de
  combustible, proveedores de combustible.
- El hub de flota enlaza correctamente las superficies canónicas.
- Vehículos: editar, desactivar y reactivar funcionan.
- Proveedores de combustible: crear y ciclo de estado (activar/desactivar) funcionan.

Esto cierra la Fase 6.3 para los catálogos migrados.

### Capturas visuales — verificación post-Pasada 13 (2026-07-11)

Se ejecutó `npm run screenshots` que levanta la app en `CAPTURE_DATABASE_URL` con
datos sembrados, recorre 108 rutas en viewports desktop (1920×1080) y mobile (390×844),
y genera capturas PNG. Resultado: **216 capturas exitosas, 0 errores HTTP**.

Las capturas están en `audit/screenshots/2026-06-09-playwright/` con su
`manifest.json`. Cierra la Fase 6.5.
