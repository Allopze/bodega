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
| Productos y EPP | Funcional y avanzado | Tiene categorías, atributos, proveedores, variantes agrupadas, importación XLSX revisable y presets EPP. Hay invariantes duplicadas y catálogos auxiliares desconectados. |
| Unidades y plantillas de atributos | No cumplen todavía su propósito | Se pueden administrar, pero el formulario de producto sigue usando unidades estáticas y no consume las plantillas. La creación de una plantilla `select` no permite cargar opciones al cambiar el tipo. |
| Vehículos | Parcial | La tabla y formularios administran solo una fracción del esquema. Estado operacional, responsable, documentos, vencimientos, seguro y notas no se pueden mantener desde el catálogo. |
| Parámetros de flota | Parcial y actualmente inefectivo | Se guardan el estado predeterminado y los días de aviso, pero la creación de vehículos no aplica el estado y el cálculo de vencimientos no consume los días configurados. |
| Proveedores de combustible | Funcional básico | Permite crear, editar y desactivar, pero no buscar, ordenar, reactivar ni reutilizar el maestro general de proveedores. |
| Taxonomía SST | Bien | Categorías y tipos tienen edición, activación, búsqueda, reglas de vigencia y siembra idempotente. La interfaz duplica acciones y puede simplificarse. |
| Catálogos PDTP | Funcional básico | Responsables y hojas se pueden crear y editar. Faltan activación/archivo y la lista de roles de la UI está codificada, aunque el servidor usa el registro real. |

## Evidencia confirmada en código

### 1. Los catálogos auxiliares de productos no gobiernan el producto

- `ProductForm` usa `UOM_OPTIONS`, un arreglo estático, y no consulta
  `product_units`.
- `product_attribute_templates` solo se consulta desde su propia página de
  administración. No se aplica al elegir una categoría ni se ofrece al editar un
  producto.
- El formulario de plantillas calcula si debe mostrar opciones desde el valor inicial.
  Cambiar el tipo de `text` a `select` no revela el campo requerido de opciones.
- La categoría de una plantilla se ingresa como texto. La ayuda dice "slug", pero la
  columna referencia el `id` de `product_categories`.
- La interfaz avisa que las unidades heredadas deben reemplazarse manualmente, aun
  cuando el catálogo pretende normalizarlas.

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
