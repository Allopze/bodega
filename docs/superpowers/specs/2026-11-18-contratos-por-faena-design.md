# Contratos dentro de la faena: equipos y costos por contrato

Fecha: 2026-11-18 · Estado: borrador para aprobación

## 1. Intención

En la realidad una faena (un lugar) tiene varios contratos con el mandante para
servicios distintos: en Cholguán, uno para mover residuos y otro para carga y
descarga de madera; en Santa Fe, Grúas y Calymag. La plataforma sólo conoce la
faena, así que hoy no se puede saber qué equipos trabajan para qué contrato ni
cuánto cuesta cada uno.

El usuario quiere dos cosas, en sus palabras: **«ver costos y equipos separados
por contrato»** y **«poder ver visualmente la separación entre faena y
contrato»**.

Señales de que el modelo ya se está filtrando por falta de esto: faenas
nombradas «Cholguan - Arauco» / «Teno - Arauco» (faena - mandante), y la
unificación de faenas del 2026-10-31 en la que Grúas y Calymag dejaron de ser
faenas porque son contratos de Santa Fe.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**

1. Una faena tiene cero o más contratos; cada contrato tiene un mandante.
2. Cada equipo de flota está asignado a **un solo contrato a la vez**, con fecha
   desde/hasta, dentro de su faena.
3. El costo de cada contrato en un período se ve en la plataforma, separado del
   resto de la faena.
4. Una vista muestra la jerarquía faena → contratos → equipos, de forma que se
   distinga a simple vista qué es faena y qué es contrato.

**No objetivos (v1)** — quedan fuera a propósito; el modelo no debe impedirlos:

- Permisos por contrato. Quien ve una faena sigue viendo todos sus contratos; la
  faena sigue siendo el único eje de alcance (`lib/auth/scope.ts`).
- Trabajadores, Prevención (PDTP, MIPER, CPHS, indicadores SST) por contrato.
- Repartir el costo de un equipo entre varios contratos (porcentajes). El usuario
  no conoce equipos compartidos; si aparecen, la extensión es una columna de
  porcentaje en la asignación, no un rediseño.
- Imputar a un contrato las compras que no cuelgan de un equipo (bodega, EPP, OC
  generales de la faena). Quedan en la faena como «Sin equipo».
- Margen por contrato (facturado − costo). Es el paso natural siguiente y el
  enfoque elegido lo deja servido, pero no entra en v1.
- Filtro por contrato en los tableros de Indicadores (`/flota/indicadores`,
  `/mantencion/panel`, `/combustibles`) y en Inicio.

**Anti-objetivos** — sería un fracaso aunque funcione:

- Que el contrato se convierta en una pseudo-faena: que aparezca en selectores de
  faena, en `worksite_users`, o en cualquier filtro de alcance.
- Cifras inventadas: prorratear por días de calendario o por cualquier regla que
  no esté respaldada por un dato con fecha.
- Que el costo repartido en contratos y restos no cuadre con el costo por equipo
  del Panel operacional (§ 7): plata que aparece o desaparece al separar.
- Dos conceptos distintos llamados «contrato» en la plataforma.

## 3. Estado actual (lo que el builder debe saber)

- **Faena como eje.** 57 archivos de `db/schema` llevan `worksite_id` y ~936
  archivos de `lib/` + `app/` lo usan. El alcance de usuario es
  `worksite_users` + `roles.is_global`.
- **Ya existe `contracts`** (`db/schema/clients.ts`): `client_id` NOT NULL,
  `worksite_id` opcional (nulo = transversal), `cost_center_id`, fechas,
  `billing_cycle` (`monthly` | `milestone` | `none`, default `monthly`),
  `period_amount`, `status` (`active` | `suspended` | `closed`). Hoy sólo lo usa
  Facturación: se administra en `/facturacion/clientes`
  (`client-contract-manager.tsx`, `saveContractAction`) con
  `billing:manage_clients`; `billing_invoice_links` y `billing_proposals` ya
  tienen `contract_id`.
- **Datos reales (clon de prod del 2026-11-02, `bodega_dev`):** 6 clientes y 4
  contratos, todos de demostración sembrados por `scripts/dev-seed/facturacion.ts`.
  Facturación sí sincroniza facturas reales (565, receptores CMPC, Maderas
  Arauco, Masisa, Biodiversa…), pero nadie mantiene clientes ni contratos. Prod
  presumiblemente tiene 0 contratos — **verificar con una lectura READ ONLY
  autorizada antes de la migración**.
- **Facturación > Pendientes** (`lib/services/billing/pending.ts`) lista un
  «período sin facturar» por cada mes de cada contrato `active` + `monthly`
  desde `start_date`. Ver § 9, punto abierto 1.
- **Equipos.** Los equipos con costo son `fuel_vehicles` (flota y maquinaria;
  ~142 en prod). `fuel_vehicles.worksite_id` es sólo la faena **actual**, sin
  historia. La única historia con fechas es `fuel_provider_mappings`
  (patente → equipo → faena) de la integración de combustible. El cambio de
  faena lo hace `lib/services/mantencion/equipment.ts` (mueve los mapeos con
  `moveProviderMappingsWithVehicleTx`); hay otros escritores de
  `fuel_vehicles` (`update(fuelVehicles)` aparece en 7 archivos). Se administran
  con `mant:equipment:manage`.
  *Nota de integración (2026-11-19):* desde el traslado de equipos
  (`feat/traslado-equipos-faena`, fusionado a main) la faena sólo cambia por
  `transferVehiclesTx` (`lib/services/fleet-transfers.ts`). Ese traslado cierra
  el contrato de origen el día anterior a la fecha (`relocateVehicleWorksiteTx`),
  y su anulación lo devuelve (`revertVehicleRelocationTx`), con el mismo
  criterio con que reabre la estadía de origen. `service_equipment` (monogas, alcotest…) no entra.
- **Costo por equipo.** Lo arma `lib/services/operational-control.ts` para el
  Panel operacional (`/control-operacional`):
  - combustible: monto del libro del proveedor (`fuel_provider_transactions`,
    `getAssetFuelSummary`), con fecha `occurred_at`. En el clon, ~38 % del
    monto viene en filas `granularity = 'period_aggregate'` (informe TCT,
    agregado **mensual** por patente), no por transacción;
  - compras: líneas de OC ligadas al equipo por
    `purchase_request_items.vehicle_id`, fechadas por emisión de la OC
    (`vehicle-purchase-summary.ts`, `issuedOrderPredicate`);
  - mano de obra de OT (`total_cost`), que la rama sin fusionar
    `feat/ot-sin-costo` retira.
- **Precedente de reparto:** `lib/combustibles/copec-day-split.ts` (decisión del
  usuario 2026-11-05) atribuye cada transacción a la faena que la patente tenía
  ese día y, si no hay detalle por transacción o no cuadra, deja la fila
  pendiente en vez de prorratear.

## 4. Enfoques considerados

| | Enfoque | A favor | En contra |
|---|---|---|---|
| **A** ✅ | Reutilizar `contracts` de Facturación como el único contrato de la plataforma, más una tabla de asignación equipo → contrato con fechas | Un solo concepto; facturas y propuestas ya cuelgan de `contract_id`, así que margen por contrato queda a un join | Cada contrato necesita su mandante como cliente; la tabla trae campos de cobro que operaciones no usa; interacción con Pendientes (§ 9) |
| B | Tabla nueva de «contratos operativos» bajo la faena | Simple, sin tocar Facturación | Dos cosas llamadas contrato (anti-objetivo; AGENTS.md «Reuse before creating»); el margen obligaría a cuadrar ambas |
| C | Contratos como sub-faenas (faena hija) | Lo más barato: todo ya filtra por faena | Repite «Calymag como faena»; multiplica faenas en permisos, PDTP, CPHS, trabajadores y selectores; borra la separación que el usuario quiere ver |
| — | Centros de costo | Ya tienen `worksite_id` | Concepto contable, 3 filas de demo, semántica distinta |

**Elegido: A.** El usuario delegó el cómo («¿qué me recomiendas?», «procede»).

## 5. Decisiones

Marcadas **[usuario]** las que tomó el usuario y **[propuesta]** las que propuse
y el usuario no objetó o que son mi decisión; corregibles al revisar este
documento.

1. **[usuario]** Alcance: equipos y costos por contrato, más una vista que
   separe faena y contrato.
2. **[usuario]** Un equipo pertenece a un solo contrato a la vez. «No hay equipos
   compartidos que yo sepa».
3. **[propuesta]** Los permisos no cambian: la faena sigue siendo el alcance.
4. **[propuesta]** Lo que no cuelga de un equipo queda en la faena como «Sin
   equipo»; no se reparte.
5. **[propuesta]** La asignación lleva fechas para que el costo de un mes no
   cambie cuando el equipo se mueve después.
6. **[propuesta]** Un equipo sin contrato en una fecha cae en «Sin contrato» de su
   faena.
7. **[usuario]** Hoy nadie usa Facturación: los contratos creados desde la faena
   nacen «Sin calendario» y no alimentan Pendientes (§ 9).

## 6. Modelo de datos

### 6.1 `contracts` (existente)

Sin cambios de columnas obligatorios. Reglas nuevas, en el servicio (no hay
datos reales que migrar):

- Un contrato que recibe equipos **debe** tener `worksite_id`. Los transversales
  (nulo) siguen existiendo para Facturación pero no reciben equipos.
- No se puede cambiar `worksite_id` ni anularlo mientras el contrato tenga
  asignaciones; tampoco acortar `end_date` por debajo de una asignación vigente.
- La FK `contracts.worksite_id` pasa de `on delete set null` a `restrict`
  **[propuesta]**: borrar una faena con contratos debe fallar, no dejar equipos
  asignados a un contrato sin faena.
- `code` (NOT NULL, único) hoy se escribe a mano en Facturación. Si viene
  vacío se genera `CTR-AAAA-NNNN` con el mecanismo existente de
  `db/schema/code-sequences.ts`; aplica a ambos formularios **[propuesta]**.
- Mandante: en prod no hay clientes reales, así que el formulario de contrato
  de la faena permite **crear el mandante en línea** (RUT + razón social), con
  `admin:worksites`, sugiriendo los receptores de las facturas ya sincronizadas
  (`billing_invoices.receiver_tax_id` / `receiver_name`: Maderas Arauco, CMPC,
  Masisa…). El resto de los datos del cliente se completa en Facturación
  **[propuesta]**.

### 6.2 `contract_vehicle_assignments` (nueva)

| columna | tipo | nota |
|---|---|---|
| `id` | text PK | |
| `contract_id` | FK `contracts`, `restrict` | |
| `vehicle_id` | FK `fuel_vehicles`, `restrict` | |
| `valid_from` | text `YYYY-MM-DD` | día civil de Chile, inclusivo |
| `valid_to` | text `YYYY-MM-DD` nulo | **inclusivo** (último día); nulo = vigente. Misma convención que `fuel_provider_mappings`: al cerrar, `valid_to` = día anterior al nuevo `valid_from` |
| `reason` | text nulo | |
| `created_by_user_id`, `created_at`, `updated_at` | | auditoría también en `recordAudit` |

Invariantes:

- `valid_to IS NULL OR valid_to >= valid_from` (CHECK).
- A lo más una asignación abierta por equipo: índice único parcial
  `(vehicle_id) WHERE valid_to IS NULL`, igual que
  `fuel_vehicle_operational_intervals`.
- Sin traslapes por equipo: validado en el servicio dentro de la transacción,
  con bloqueo de la fila del equipo (`SELECT … FOR UPDATE` sobre
  `fuel_vehicles`). El repo no usa `btree_gist`/`EXCLUDE`; no agregar una
  extensión sólo por esto **[propuesta]**.
- La faena del contrato = la faena del equipo al asignar. El intervalo debe caer
  dentro de `start_date`/`end_date` del contrato cuando existan.
- **Al cambiar un equipo de faena**, en la misma transacción se cierra su
  asignación abierta con `valid_to` = día anterior a la fecha del cambio, y se
  borran (auditado) las que empiecen en esa fecha o después. Aplica a **todos** los
  escritores de `fuel_vehicles.worksite_id`, no sólo a
  `lib/services/mantencion/equipment.ts`; el builder debe inventariarlos.
- Asignar con fecha pasada está permitido (lo exige la carga inicial) y queda
  auditado **[propuesta]**. No cambia el total de la faena, sólo su reparto
  interno.

Migración: `db:generate` según `db/migrations/README.md`, checksum en
`_sql-checksums.json`. Sin backfill: no hay datos que derivar.

## 7. Atribución de costos

**Regla única:** el costo de un contrato en un período es la suma de las
partidas de costo por equipo **con la misma definición que use en ese momento el
costo por equipo del Panel operacional** (no se crea una segunda definición; si
`feat/ot-sin-costo` se fusiona, el costo por contrato pierde la mano de obra de
OT automáticamente). Cada partida tiene una fecha y va al contrato que el equipo
tenía ese día.

| Partida | Fecha que manda |
|---|---|
| Combustible, fila `transaction` | `occurred_at` |
| Compras (línea de OC con `vehicle_id`) | emisión de la OC |
| OT (mientras exista) | cierre de la OT, como hoy |
| Combustible, fila `period_aggregate` | ver abajo |

**Agregados mensuales (TCT):** si el equipo tuvo un solo contrato (o ninguno)
durante todo el período del agregado, va a ese contrato (o a «Sin contrato»). Si
cambió de contrato dentro del período, se usa el detalle por transacción con el
mismo criterio de `copec-day-split.ts`; sin detalle o si no cuadra, el monto va a
**«Por repartir»** de la faena, visible, nunca prorrateado.

**Faena de una partida [propuesta].** La faena de un costo atribuido a un
contrato es la **del contrato** (histórica): el costo de febrero de un equipo que
en octubre se movió de faena sigue en el contrato —y la faena— de febrero. Es lo
que justifica las fechas (decisión 5). Un costo sin asignación ese día cae en
«Sin contrato» de la faena **actual** del equipo, igual que el Panel de hoy (no
hay historia de faena del equipo de donde sacar otra cosa). El alcance de un
usuario sobre estas cifras es el de la faena del contrato.

**Cubetas por faena** (cada una se muestra sólo si es distinta de cero):

- cada contrato;
- **Sin contrato**: costo de equipos sin asignación ese día;
- **Por repartir**: agregados que no se pudieron atribuir;
- **Compras sin equipo**: líneas de OC emitidas (`issuedOrderPredicate`) con
  `purchase_orders.worksite_id` = la faena y sin `vehicle_id`. El combustible
  sin equipo (cargas a estanques) **no** entra en v1: hoy el Panel tampoco lo
  imputa y sumarlo arriesga contar dos veces lo que después se despacha a un
  equipo **[propuesta]**.

La fila de la faena muestra la suma de sus cubetas; no se presenta como «el
costo total de la faena» ni se compara con cifras de otras pantallas.

**Invariante (con prueba) [propuesta]:** a nivel **global** (todas las faenas
del alcance), Σ contratos + Sin contrato + Por repartir = Σ costo por equipo del
Panel operacional en el mismo período. Por faena no tiene por qué cuadrar con el
Panel cuando un equipo cambió de faena: el Panel imputa todo a la faena actual.

**Componentes sin dato [propuesta].** El Panel deja `totalCost` en null cuando
falta un componente de un equipo. Aquí cada columna (Combustible, Compras, OT
mientras exista) suma lo conocido; la columna Total de un contrato sólo se
muestra si todos sus componentes son calculables para todos sus equipos; si no,
se muestra la suma marcada «parcial» con el número de equipos incompletos. La
prueba de la invariante se hace por componente.

**Permisos de cifras:** se mantienen los de hoy (`combustibles:view_costs`,
`canViewPurchaseCosts`). Sin ellos se ven contratos y equipos, sin montos. El
nombre del mandante se muestra sin permisos de Facturación: ya está en el
nombre de las faenas («Cholguan - Arauco») y no es un dato financiero
**[propuesta]**.

Una faena sin contratos se muestra como hoy, sin cubetas: «Oficina Central» no
debe aparecer con una fila «Sin contrato» que lo es todo **[propuesta]**.

## 8. Pantallas

Todas siguen AGENTS.md (PageHeader, PageContainer, tarjetas flotantes, A1–A6,
`router.replace` + `scroll: false` en filtros, `ExportButton`, `DatePicker`).

### 8.1 Faena → contratos → equipos (administración y la «separación visual»)

Nueva ruta `/admin/faenas/[id]` (hoy Faenas no tiene detalle), ancho
`workbench`. Contratos con `admin:worksites`; asignar equipos con
`mant:equipment:manage` **[propuesta]**.

```
Cholguan - Arauco                                  [Nuevo contrato]
Faena · Región del Biobío · 15 equipos · 2 contratos

┌ Movimiento de residuos ──────────── Maderas Arauco · desde 01-03-2026 ┐
│ CR-52  Cargador · ABCD-12          desde 01-03-2026                    │
│ TO-37  Tolva · EFGH-34             desde 15-06-2026                    │
│ …                                              [Asignar equipos]      │
└───────────────────────────────────────────────────────────────────────┘
┌ Carga y descarga de madera ──────── Maderas Arauco · desde 01-01-2026 ┐
│ …                                                                      │
└───────────────────────────────────────────────────────────────────────┘
┌ Sin contrato ─────────────────────────────────────────────────────────┐
│ GR-10  Grúa · IJKL-56                                  [Asignar]       │
└───────────────────────────────────────────────────────────────────────┘
```

- «Nuevo contrato» / editar: nombre, mandante (elegir o crear en línea, § 6.1),
  fecha desde/hasta, estado; código autogenerado. Los campos de cobro (ciclo, monto, plazo, centro de
  costo, OC marco) se editan sólo en Facturación. El formulario de Facturación y
  éste comparten componente/validación; no se crea un segundo formulario de
  contrato.
- «Asignar equipos»: `Sheet` con los equipos de la faena (multiselección,
  muestra el contrato actual de cada uno) + `DatePicker` «desde». Es lo que hace
  viable la carga inicial de ~142 equipos.
- Equipos con `VehicleIdentity`; cero contratos → `EmptyState` con CTA «Nuevo
  contrato».
- La lista de Faenas (`/admin/faenas`) enlaza a este detalle y muestra el número
  de contratos.

### 8.2 Ficha del equipo (`/flota/[id]`)

Junto a la faena: «Contrato: Movimiento de residuos (desde 01-03-2026)» o «Sin
contrato». Acción «Cambiar contrato» (`Sheet`, contrato de la faena + fecha
desde) con `mant:equipment:manage`, e historial de asignaciones.

### 8.3 Panel operacional (`/control-operacional`): costo por contrato

- Filtro **Contrato** dependiente de Faena (`?contrato=`), intersectado con el
  alcance de faena.
- Sección «Costo por contrato» sobre la tabla de equipos: una tabla agrupada por
  faena con subtotal, filas = contratos + cubetas, columnas = Mandante · Equipos
  · Combustible · Compras · Total. Clic en un contrato filtra la tabla de
  equipos.

```
Costo por contrato · noviembre 2026
Cholguan - Arauco                                   Total  $48,2 M
  Movimiento de residuos       Maderas Arauco   6   $15,1 M  $6,4 M  $21,5 M
  Carga y descarga de madera   Maderas Arauco   9   $14,0 M  $5,8 M  $19,8 M
  Sin contrato                                  1    $1,9 M  $0,5 M   $2,4 M
  Sin equipo                                    —        —   $4,5 M   $4,5 M
Santa Fe                                            Total  $…
  Grúas …
```

(Cifras ilustrativas.)

- Columna **Contrato** en la tabla de equipos y en el Excel
  (`lib/operational-control/export-columns.ts`).
- La sección cuenta para A1: no son tiles; es una tabla.

## 9. Interacción con Facturación

Un contrato `active` + `monthly` aparece en Facturación > Pendientes con un
«período sin facturar» por mes desde su inicio, y hoy ninguna factura está
ligada a un contrato real. **[usuario] «Hoy nadie usa Facturación».** Por eso un
contrato creado desde la faena nace con `billing_cycle = 'none'` («Sin
calendario» en la UI de Facturación) y no aparece en Pendientes. Cuando
Facturación empiece a cobrar por contrato, lo cambia a «Mensual» desde su propio
formulario. Sin cambios de esquema ni en `pending.ts`.

## 10. Lo que queda al builder

- Nombres finales de servicios, componentes y la ubicación exacta de la sección
  en el Panel operacional, siguiendo la estructura actual de la página.
- Cómo consultar la atribución por día sin una consulta por equipo (mismo
  criterio que `getAssetFuelSummary`: una consulta agrupada por dimensión).
- Inventario de escritores de `fuel_vehicles.worksite_id` (`update(fuelVehicles)`
  aparece en 7 archivos, incluido `lib/combustibles/copec-day-split.ts`) y su
  cierre de asignación.
- Al asignar con fecha pasada, avisar (no bloquear) si `fuel_provider_mappings`
  muestra al equipo en otra faena en parte de ese intervalo.
- Paridad de permisos y navegación (`modules/registry.ts`, `modules/permissions.ts`,
  manifiestos) para la ruta nueva; no se crean permisos nuevos en v1.

## 11. Verificación esperada

- Unitarias: atribución por día, agregados mensuales con y sin cambio de
  contrato, cubetas, invariante de cuadratura.
- PGlite: sin traslapes, una abierta por equipo, cierre al cambiar de faena,
  bloqueo de cambios de faena/fechas del contrato con asignaciones.
- E2E: crear contrato, asignar equipos en lote, ver el costo por contrato y
  filtrar; locators según «Locators in this repository».
- Navegador sobre `bodega_dev` con datos sembrados (contratos y asignaciones
  `QA_`), incluyendo la cuadratura contra el Panel operacional actual.
