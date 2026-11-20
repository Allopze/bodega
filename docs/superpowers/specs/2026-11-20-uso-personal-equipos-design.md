# Uso personal de equipos: períodos que no cuentan en costos ni consumo

Fecha: 2026-11-20 · Estado: borrador para aprobación

## 1. Intención

El dueño a veces se lleva un equipo de la flota para asuntos personales. Mientras
lo tiene, el equipo carga combustible, recorre kilómetros y puede generar compras,
y hoy todo eso se suma a los costos y al consumo de la faena y el contrato a los
que pertenece el equipo. Las cifras de la operación quedan infladas con un gasto
que no es de la operación.

El usuario lo pidió así: «debe haber la opción de poder marcar eso para que los
costos no cuenten durante ese período». En la conversación decidió además:

- Los costos de ese período **desaparecen** de los reportes. No se muestran
  aparte en un renglón «Uso del dueño». Era la opción B, y la descartó.
- También dejan de contar los **litros y los kilómetros**, para que el consumo de
  la faena y el costo por kilómetro no salgan distorsionados.
- **Mantención es la excepción.** Los kilómetros del uso personal desgastan el
  equipo y siguen contando para sus pautas.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**

1. Marcar en un equipo uno o más períodos de uso personal (desde, hasta) con una
   nota opcional, y poder corregirlos o quitarlos.
2. Que en esos días el equipo no sume plata, litros ni kilómetros en ningún
   reporte agregado de la operación: costos, consumo, rendimiento, costo por km e
   indicadores.
3. Que quede registro de quién marcó, corrigió o quitó cada período.

**No objetivos (v1)**

- Detectar el uso personal automáticamente, por ejemplo con el GPS durmiendo fuera
  de la faena. El análisis del 2026-11-19 muestra que sería posible, pero el
  usuario no lo pidió.
- Un reporte o renglón de «cuánto costó el uso personal» (opción B, descartada).
- Cobrarle o imputarle el gasto a una persona.
- Repartir el uso personal por horas: la unidad es el día calendario de Chile.

**Anti-objetivos** (sería un fracaso aunque funcione)

- Cambiar lo que se le **paga** a Copec o a un proveedor. La cuadratura, los
  pagos, la conciliación de facturas y la bitácora de cargas siguen viendo todas
  las transacciones. Sólo se excluyen de los **agregados de gestión**.
- Que marcar un uso personal cambie la faena, el contrato, el estado operativo,
  la disponibilidad o los permisos sobre el equipo.
- Que dispare alertas: «consumo estando inactivo», anomalías o «equipo detenido».
- Que un reporte excluya el período y otro no. Una cifra que cambia según la
  pantalla es peor que no tener la función.
- Que haya que trasladar el equipo a una faena ficticia para marcarlo.

## 3. Estado actual (lo que el builder debe saber)

Relevado el 2026-11-20 sobre `main` 724dc4f6e.

**No existe ningún concepto que excluya un equipo o un período de los costos.**
`comparison_group`, `fuel_provider_transactions.status = 'excluded'` (patente
fuera de flota) y `performance_status = 'excluded'` son otras cosas.

**Dónde se suma plata por equipo, faena o contrato:**

| Lugar | Qué suma | Fecha que usa | Faena que usa |
|---|---|---|---|
| Control operacional (`lib/services/operational-control.ts`, `getOperationalControlHub`) | combustible facturado (`getAssetFuelSummary`, `lib/combustibles/control/queries/asset-fuel-summary.ts`) + líneas de OC (`getVehiclePurchaseSummary`, `lib/services/purchasing-module/vehicle-purchase-summary.ts`) | combustible: `left(occurred_at,10)` (día UTC); OC: `left(issued_at,10)` | faena actual del equipo |
| Excel de Control operacional (`app/(app)/control-operacional/actions.ts`, `lib/operational-control/export-columns.ts`) | lo mismo que la tabla | — | — |
| Costo por contrato (`lib/services/contracts/contract-costs.ts` → `lib/contracts/cost-attribution.ts`) | mismas fuentes, por día (`getFuelBilledByVehicleDay`, `getVehiclePurchaseByDay`) | por día; el TCT mensual va a «Por repartir» si cruza dos ventanas | ventana de contrato del día, si no la hay, «Sin contrato» de la faena actual |
| Flota (`lib/services/fleet.ts`) | Σ `fuel_provider_transactions.amount` 12 meses | — | faena actual |
| Analítica (`lib/services/analytics-module/dashboard.ts`) | combustible total, tendencia, top-10 equipos | día de Chile | `worksite_id` de la transacción |
| Inicio Finanzas / Flota (`lib/services/dashboard-fuel.ts`, `getFuelMonthlyTrend`) | combustible por mes | `left(occurred_at,7)` | `worksite_id` de la transacción |
| Consumo (`lib/combustibles/consumption-dashboard.ts`) | `fuel_consumption_records.monto` | `periodo_desde/hasta` | `worksite_id` del registro |
| «Facturado» (`lib/combustibles/fuel-control-overview.ts`) | `fuel_loads.total_amount` (vacía en prod) | — | — |

Las reglas de «qué transacción cuenta» son `accountableProviderTransactionsWhere()`
(`lib/combustibles/load-status.ts`), `billedTransactionsWhere` y, para OC,
`countedOrderLineWhere`. **No sirven para colgar la exclusión**: también las usan
la cuadratura y los pagos, que deben seguir viendo todo (anti-objetivo 1).

**Litros y kilómetros:**

- Litros de cargas en terreno (`fuel_equipment_loads`): Panel de combustible
  (`lib/combustibles/panel/queries.ts`), indicadores
  (`lib/combustibles/indicators/queries.ts`), rendimiento
  (`lib/combustibles/control/queries/performance.ts`), ralentí, proyección y otras
  consultas de `lib/combustibles/control/`.
- Costo por km/hora en Control operacional: `computeGpsAdvance` →
  `meterSeriesAdvance(points, maxPerDay)` sobre la serie del medidor del período
  (`operational-control.ts` ~263-291, 610-632).

**Modelos de período que ya existen**, de los que conviene copiar las convenciones:

- Estadías por faena, `fuel_vehicle_worksite_intervals`
  (`db/schema/fleet-transfers.ts`): `started_on`/`ended_on` como texto
  `YYYY-MM-DD`, ambos inclusivos, `ended_on` nulo = abierto, sin solapes (los
  impide un trigger).
- Asignaciones a contrato, `contract_vehicle_assignments`: `valid_from`/`valid_to`
  inclusivos.

**`operational_status`** (`operativo | mantencion | fuera_servicio`) **no se debe
usar**: lo leen la disponibilidad, «equipos detenidos», las solicitudes de compra y
el detector `detectConsumptionWhileInactive`, que abriría un caso por cada carga
del período.

## 4. Enfoques considerados

| Enfoque | Qué es | Por qué sí / por qué no |
|---|---|---|
| **A. Registro propio de períodos (elegido)** | Tabla nueva de períodos por equipo + una regla común «¿estaba en uso personal ese día?» aplicada en cada agregado | No toca faena, contrato, estado ni permisos. Los reportes de gestión la aplican y los de pago no. Es la única que excluye bien los períodos pasados. |
| B. Faena «Uso del dueño» + traslado | Trasladar el equipo a una faena ficticia durante el período | Cambia faena, contrato y permisos (el mecánico pierde el equipo). Depende del traslado, que está apagado en prod. Los costos se calculan con la faena **actual**, no con la del día, así que no excluiría el pasado. Además infringe un anti-objetivo de Contratos («pseudo-faenas»). |
| C. Estado operativo «uso personal» | Valor nuevo de `operational_status` | Dispara «consumo estando inactivo», baja la disponibilidad y marca el equipo en las solicitudes de compra. Habría que poner excepciones en cada lector del estado. |
| D. Marcar cada transacción | Clasificar cada carga u OC como personal | Alguien tendría que clasificar cada carga. No resuelve los kilómetros. |

El usuario aprobó A (2026-11-20).

## 5. Diseño

### 5.1 Datos

Una tabla nueva, por ejemplo `fuel_vehicle_personal_use_periods`:

- `id`, `vehicle_id` (FK a `fuel_vehicles`)
- `started_on` (texto `YYYY-MM-DD`, obligatorio) y `ended_on` (texto, nulo =
  todavía en uso personal); ambos inclusivos, en días calendario de Chile
- `note` (texto corto, opcional)
- `created_by_user_id`, `created_at`, `updated_at`

Reglas:

- `ended_on >= started_on`.
- **Sin solapes** entre períodos del mismo equipo. El mecanismo lo elige el
  builder: trigger como en las estadías, o validación bajo bloqueo en la
  transacción del servicio.
- `started_on` no puede ser futuro. `ended_on` tampoco: mientras el equipo no
  vuelve, el período queda abierto. *(decisión del agente)*
- Se puede marcar hacia atrás **sin límite**: sólo cambia reportes de gestión,
  no pagos. *(propuesta aceptada por el usuario)*
- Corregir y quitar están permitidos. Cada alta, cambio o baja deja una fila en
  `audit_log` con el estado anterior y el nuevo.

La migración sigue las reglas de `AGENTS.md`: `db:generate`, checksum en el
manifiesto y nada de editar el journal.

### 5.2 La regla común

Una sola función o fragmento SQL, por ejemplo `personalUseOnDaySql(vehicleId,
day)` y su par para rangos, en `lib/fleet/`. **Todos** los agregados de §5.3 la
usan; ninguno reimplementa el cruce.

- **El día de un ítem es su día calendario de Chile**, aunque el reporte agrupe
  por otra regla. Hay reportes que hoy usan el día UTC; la exclusión siempre
  compara con el día de Chile. *(decisión del agente: la persona marca días de
  Chile)*
- **Combustible Copec/TAE:** se excluye la transacción cuyo día cae en el período.
- **OC:** se excluye la línea cuya OC se emitió (`issued_at`) dentro del período.
  Es la misma fecha que ya usan los reportes. *(decisión del agente)*
- **TCT mensual** (`period_aggregate` o un registro de consumo con
  `periodo_desde/hasta`): si el período cubre parte del mes, se descuenta la
  **fracción de días** (días de uso personal del mes / días del mes), en monto y en
  litros. *(propuesta aceptada por el usuario)*
  - Ojo: el diseño de Contratos tiene como anti-objetivo «prorratear por días de
    calendario», y por eso manda el TCT partido a «Por repartir». Aquí se prorratea
    porque no hay otro dato. En Costo por contrato, lo que queda del TCT después
    de descontar el uso personal sigue la regla actual (contrato, o «Por repartir»
    si cruza dos ventanas). El builder debe cuidar que las sumas cuadren (§6).
  - El denominador es el **largo del propio registro** (`periodo_desde..hasta`, o el
    mes calendario de un `period_aggregate`); el numerador, los días de uso
    personal que se solapan con él. Cuando hay detalle de transacciones para la
    patente, el agregado ya no cuenta (`load-status.ts`) y no hay nada que
    prorratear. *(decisión del agente)*
- **Cargas en terreno (litros):** se excluye la carga cuyo día cae en el período.
- **Rendimiento (km/L, L/h):** se excluyen las cargas del período **y la primera
  carga después del período**. Su `performance_value` se calculó contra una
  lectura anterior, así que su intervalo incluye los kilómetros del uso personal.
  Los litros de esa primera carga sí cuentan en el consumo, que se excluye sólo
  por día. *(decisión del agente)*
- **Kilómetros/horas (costo por km):** el avance GPS del período se calcula **sin
  los días de uso personal**. Por ejemplo, como la suma de los avances de los
  tramos que quedan fuera del período. El builder elige la forma, respetando
  `maxPerDay`.

### 5.3 Dónde se aplica y dónde no

**Se aplica** en todo agregado de gestión de §3: Control operacional (tabla, Excel
y costo por km), Costo por contrato, Flota, Analítica, Inicio (Finanzas y Flota),
Consumo, Panel de combustible, indicadores de combustible y de flota, rendimiento,
ralentí y proyección. El builder debe completar la lista buscando cada consulta que
sume `fuel_provider_transactions`, `fuel_equipment_loads`,
`fuel_consumption_records`, `fuel_loads` o líneas de OC por equipo, y dejar
documentado en el plan qué consultas tocó y cuáles dejó fuera, y por qué.

**Una regla para kilómetros y horas:** todo agregado de gestión de km, horas de
motor o ralentí pierde los días de uso personal. Eso incluye el costo por km de
Control operacional, los km/h GPS de `/flota/indicadores`
(`lib/services/fleet-gps-indicators.ts`) y el ralentí. Los registros crudos no
cambian: Monitoreo, recorridos y posiciones. Mantención tampoco. Así un equipo
nunca muestra km distintos en dos pantallas de gestión. *(decisión del agente, que
aplica la del usuario)*

**Panel de combustible:** sus gráficos de litros e indicadores excluyen el uso
personal y llevan una nota «Excluye uso personal» cuando el período tiene días
excluidos. La tira de cinco pasos (Fuentes → Por revisar → Cuadratura → Equipos →
Pagos) es el flujo de pago y no cambia. *(decisión del agente)*

**Para todos los roles:** la exclusión aplica a quien mire el reporte. El permiso
sólo gobierna quién marca. *(decisión del agente)*

**Nada que recalcular:** no hay agregados de costo guardados. La única foto
periódica, `operational_metric_snapshots`, guarda conteos de pendientes, no plata.
Marcar, corregir o quitar un período se refleja de inmediato.

**No se aplica:**

- Cuadratura, pagos y conciliación de facturas con Copec o proveedores.
- Bitácora de cargas, «Por revisar», historial de cargas y compras en la ficha:
  son registros, no agregados. Siguen mostrando la transacción, con una marca
  visible «Uso personal» cuando cae en un período. *(decisión del agente)*
- **Mantención, entera:** lecturas, pautas, estimaciones por GPS, OT **y costos**.
  La vida del equipo (`lib/services/mantencion/equipment-life.ts`) y los
  indicadores de Mantención (`lib/services/mantencion/indicators.ts`) siguen
  sumando todas las compras del equipo. Mantención responde «¿cuánto me ha costado
  este equipo como activo?», con todo lo que se le gastó, incluido el desgaste del
  uso personal. *(decisión del usuario, 2026-11-20)*
- Monitoreo GPS en vivo, posiciones e historial de recorrido.
- Disponibilidad, estado operativo y «equipos detenidos».

**Detección de anomalías y rendimiento:** las cargas del período se excluyen
también del detector de anomalías, para no abrir casos por un uso legítimo y fuera
de la operación. *(decisión del agente; ver §8)*

### 5.4 Permiso y alcance

- Permiso nuevo `flota:personal_use` («Marcar uso personal de equipos»), dado a
  los mismos roles que `flota:transfer`: jefa Chome, jefe de mantención y
  administrador. *(propuesta aceptada por el usuario; nombre exacto a elección del
  builder)*
- Paridad completa según `AGENTS.md`: `modules/permissions.ts`,
  `modules/flota/manifest.ts`, seed / `db:sync-rbac`, la acción de servidor la
  exige, y ocultar el botón no es autorización.
- La acción valida además el alcance de faena del equipo (`canAccessWorksite`).
- Ver los períodos no requiere el permiso: quien ve la ficha los ve.

### 5.5 Pantalla

En la **ficha del equipo** (`app/(app)/flota/[id]/`), un bloque «Uso personal»
con la lista de períodos y un botón «Marcar uso personal» que abre un `Sheet`. El
`Sheet` usa `Field`, el `DatePicker` del sistema de diseño y nota opcional. Cada
período se puede «Editar» o «Quitar»; quitar pide confirmación porque cambia
cifras ya vistas.

```
Uso personal                                   [Marcar uso personal]
  12-10-2026 → 19-10-2026   Viaje del dueño     Editar · Quitar
  03-11-2026 → (en curso)                        Editar · Quitar
```

- Si hay un período abierto, la cabecera de la ficha muestra una insignia «En uso
  personal» (`Badge`, texto con tokens `-ink`). *(decisión del agente)*
- En Control operacional, la fila de un equipo con días excluidos en el período
  lleva una nota discreta «Excluye N días de uso personal», con tooltip. Explica
  por qué la cifra no calza con la factura de Copec sin mostrar el monto
  excluido. *(decisión del agente)*
- Se siguen las reglas de layout, densidad y formularios de `AGENTS.md`:
  `PageHeader`/`PageContainer` ya existen en la ficha, sin buscador propio,
  `useActionState` o `useOperation` según el envío, y fechas con
  `formatDate`/`todayInChile`.

## 6. Cómo se sabe que funciona

- Un equipo con costo C en un mes y un período de uso personal de D días con costo
  P: Control operacional, el Excel y Costo por contrato muestran C − P. En Costo
  por contrato, contratos + «Sin contrato» + «Por repartir» suman C − P.
- La cuadratura y los pagos del mismo mes muestran C, sin cambio.
- Panel de combustible e indicadores: los litros de la faena bajan exactamente en
  los litros del período.
- El costo por km usa el avance sin los días del período.
- Mantención no cambia: las mismas lecturas, estimaciones y costos antes y después.
- Ninguna alerta nueva («consumo estando inactivo», anomalías, «equipo detenido»).
- Quitar el período deja todo como estaba antes de marcarlo.
- Pruebas: unitarias para la regla y el prorrateo del TCT, PGlite para cada
  consulta tocada (con y sin período), una E2E que marca un período en la ficha y
  ve el cambio en Control operacional, y una guarda estática que falle si una
  consulta de agregado de las fuentes de §5.3 no usa la regla común.

## 7. Restricciones

- Fuente de verdad en `lib/` + `app/`. Nada en `modules/*/{services,actions}`.
- Faena de un equipo: sólo por traslado. Esta función no la toca.
- Exportes en Excel (ya lo son).
- Verificación en navegador antes de dar por terminado, con datos sembrados en
  `bodega_dev` (equipo con cargas, OC y TCT mensual en el período).

## 8. Decisiones del agente que el usuario debería revisar

1. La OC cuenta por su fecha de **emisión**: una reparación pedida durante el uso
   personal queda excluida, aunque se haga después.
2. El uso personal también se excluye del **detector de anomalías**.
3. Bitácora y «Por revisar» muestran la carga con una marca «Uso personal», sin
   ocultarla.
4. Nota en Control operacional «Excluye N días de uso personal».
5. No se puede marcar una fecha de término futura: el período queda abierto
   hasta que el equipo vuelve.
6. El rendimiento excluye también la primera carga después del período.
7. Los km, horas y ralentí de los reportes de gestión pierden los días de uso
   personal. Monitoreo y recorridos quedan como están.
8. El Panel de combustible muestra la nota «Excluye uso personal» en sus gráficos.
   La tira de pasos de pago no cambia.
9. La exclusión aplica a todos los roles.

## 9. Queda al builder

- El nombre exacto de la tabla y del permiso.
- El mecanismo contra solapes.
- La forma de calcular el avance GPS sin los días excluidos.
- La lista completa de consultas tocadas (§5.3), documentada en el plan.
- El orden de implementación y cómo dividir las pruebas.
