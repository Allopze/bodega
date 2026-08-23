# Aramco Fleet

## Estado: IMPLEMENTADO contra el contrato real y verificado en vivo (2026-08-22).

La marca Aramco en Chile la opera **Esmax** sobre la plataforma ex-Petrobras
(Paytech). El portal tiene dos frontends sobre el mismo backend:

| Frontend | Tecnología | Uso |
|---|---|---|
| `portaltarjetas.cl/sigaf/admin/` | ASP.NET WebForms, `__VIEWSTATE`, teclado virtual, ids en portugués | **descartado**: sería peor que el scraper de Copec |
| `portaltarjetas.cl/sigaf/#/` | SPA Vue sobre API REST JSON | **el que usamos** |

A diferencia de Copec —que exige Playwright para navegar un portal Telerik y
raspar un XLSX— acá se consume la misma API REST que alimenta la SPA. No hay
navegador en el camino del cron.

## Dónde está el contrato

- `lib/combustibles/aramco-client.ts` — autenticación y lectura de la API.
- `lib/combustibles/aramco-sync.ts` — mapeo a `fuel_import_batches` / `fuel_consumption_records`.
- `lib/combustibles/aramco-settings.ts` — credenciales cifradas en `system_settings`.
- `lib/combustibles/fuel-sources.ts` — etiquetas de `fuente` por producto.
- `lib/combustibles/open-period.ts` — refresco del mes en curso (compartido con Copec).

Base URL: `https://www.portaltarjetas.cl/sigaf/flota2/api/`

## Autenticación: el teclado virtual lo genera el cliente

El portal usa un teclado anti-keylogger donde cada botón cubre **dos** dígitos, de
modo que un observador aprende sólo pares. Pero el layout **lo genera el cliente**
y se envía junto con la secuencia de botones pulsados, así que el servidor puede
resolver. Autenticarse es cálculo puro: no hace falta hacer clics.

```
POST users/authenticatecredential   login=base64(documentNumber=…&password=<índices>&passwordType=2&passwordKeyboard=<pares>)
  -> [{ userId, systemOperatorId, programType, twoFactorAuthentication, … }]
     se elige programType === 1 (Flota); 2 es Fuelmax
POST token                          grant_type=password&login=base64(… &systemOperatorId=…)
  -> { access_token, environment_type, expires_in ≈ 10799 (~3 h) }
```

`password` NO lleva la clave: lleva la secuencia de **índices de botón**
(`setPassword(index)` en el portal), y `passwordType=2` le dice al servidor que
venga así. El teclado se regenera entre los dos POST, igual que el portal.

`environment_type` decide el prefijo de recurso:
`Customer` → `customers/{systemOperatorId}/`;
`CustomerCostCenter` → `customers/{userId}/costcenters/{systemOperatorId}/`.

**Dos factores:** existen `users/twofactor/start|verify`. Hoy la cuenta responde
`twoFactorAuthentication: null` y no dispara. Si lo activan, el cliente lanza
`AramcoTwoFactorRequiredError` —distinto de una caída— porque nadie lo arregla
reintentando: hace falta que una persona complete el segundo factor.

## Consulta de movimientos

```
GET {base}movements?filter=<base64(JSON)>
Authorization: Bearer <access_token>

{ pageNumber, pageSize, operador: "and",
  orderBy: [{ name: "transactionDate", order: "asc" }],
  filter: [{ name: "transactionDate", value: "01-08-2026 00:00:00", condition: "gte" },
           { name: "transactionDate", value: "31-08-2026 23:59:59", condition: "lte" }] }
```

Condiciones: `eq neq ct gt gte lt lte`. Fechas en `DD-MM-YYYY HH:mm:ss`.
Respuesta paginada estilo DataTables: `{ recordsTotal, totalPages, data }`.
**Sin filtro el endpoint responde 500**, así que el rango no es opcional.

Cada fila es una transacción, con 40 campos. Los que se usan: `transactionId`
(clave estable), `transactionDate`, `vehicleRegistrationPlate`, `cardNumber`,
`quantity`, `originalAmount`, `totalDiscountAmount`, `amountToPay`, `productName`,
`vehicleOdometer`, `vehiclePreviousOdometer`.

Otros endpoints verificados: `vehicles` (39), `vehicles/dropdown`, `cardsAdblue`
(39), `products/main` (6), `branches/all` (3), `enums/fuelType/main`,
`enums/vehicleType`. `costcenters/all` devuelve `[]` (la cuenta no los usa).

## Decisiones de mapeo, y por qué

**`monto` = `amountToPay`, no `originalAmount`.** Copec toma su `monto` de la
columna «Monto ($)», que es lo que se le cobra al cliente. `originalAmount` es
precio de lista (~1.000 CLP/L) y `amountToPay` ya trae el descuento aplicado
(872-913 CLP/L en el histórico real). Usar el primero infla el costo y descuadra
`precioPromedioUnidad` contra el `unitAmountToPay` del portal.

**El rendimiento se descarta si no es creíble.** El portal calcula
`vehicleConsumption` con el odómetro que el conductor tipea en el surtidor: en el
histórico real 48 de 154 transacciones dan valores absurdos (hasta **785 km/L**)
porque la lectura previa está desfasada, y 25 no traen odómetro. Sobre 25 km/L se
guarda `0` —«sin dato»—, que es lo mismo que hace el parser de Copec con su guard
`performance > 0`. El detalle crudo queda en `rawRow` para auditar.

**El producto viaja en `fuente`.** `fuel_consumption_records` no tiene columna de
producto, así que hay un lote por (faena, mes, producto), igual que en Copec.
`products/main` **no es exhaustivo** —el único producto que la cuenta transó,
"Aramco ProForce Diesel B" (id 6), no aparece ahí— por eso la clasificación va por
nombre: ver `aramcoSourceForProduct`.

**La faena se deriva del vehículo.** Se busca la patente en `fuel_vehicles` con
`plateMatchKey`, que normaliza el formato con espacios de Aramco (`"SZ GB 72"` →
`"SZGB72"`). Las patentes que no están en el catálogo **no se pierden**: se
devuelven como pendientes para el flujo de vinculación existente.

**No hace falta fila en `fuel_suppliers`.** Ni `fuel_import_batches` ni
`fuel_consumption_records` tienen FK a proveedor: la identidad va en `fuente`.
Sólo `fuel_loads` (facturas) exige proveedor, y no es este camino.

## Mes en curso

El sync incluye el mes abierto para dar visibilidad del consumo del día. Como su
agregado cambia con cada carga nueva, ese lote se **refresca** en cada corrida
(`upsertBatchRecords`) en vez de sólo recibir las patentes que faltaban.

Dos cuidados que el diseño respeta:

1. **No se borra y reinserta**, aunque sería más corto: al borrar se pierde el
   `vehicle_id` que un operador fijó a mano con `linkConsumptionPlateAction`,
   donde puede elegir un vehículo cuya patente **no** coincide con la del reporte.
   Ese vínculo no existe en ninguna otra parte. El refresco preserva el
   `vehicle_id` guardado cuando ya tiene valor.
2. **Si el agregado no cambió, no se toca nada** (`batchTotalsUnchanged`). Sin
   eso, un mes abierto dejaría `updated_at` nuevo en todos sus registros todos los
   días aunque nadie haya cargado combustible.

Un mes ya cerrado conserva el camino barato: su agregado es final y sólo entran
las patentes recién vinculadas.

## Configuración

Lo guardado en `system_settings` (cifrado) manda; el `.env` es respaldo.

| Setting | Env de respaldo |
|---|---|
| `combustibles.aramco.document_number` | `ARAMCO_DOCUMENT_NUMBER` |
| `combustibles.aramco.password` | `ARAMCO_PASSWORD` |
| `combustibles.aramco.sync_enabled` | `ARAMCO_SYNC_ENABLED` |
| — | `ARAMCO_SYNC_IMPORTER_EMAIL` (a quién se atribuyen los lotes del cron) |

El cifrado reusa el keyring de la aplicación (`DTE_SETTINGS_KEYRING`,
`DTE_SETTINGS_ACTIVE_KEY_ID`; el prefijo `DTE_` es histórico). El AAD de cada
sobre es la key del setting, así que un ciphertext de `dte.clave` no se puede
reutilizar acá. **Sin keyring no se guarda**: guardar en claro no es una opción, y
la UI deshabilita los campos en vez de fingir que se puede.

Un secreto vacío en el formulario **conserva** el guardado, para que abrir y
guardar no borre las credenciales sin querer.

Administración: Combustibles → Importar → «Credenciales y automatización».

## Automatización

- Ruta: `GET /api/cron/fuel-aramco-sync`, contrato `fuelCronContractFor`.
- Registro: `scripts/cron-runner.mjs` (JOBS) y `docker-compose.yml` a las **05:45**
  (desfasado del 05:30 de Copec para no competir por la misma ventana de I/O).
- Gate de módulo: `ROUTE_OWNER_ALIASES` en `lib/services/module-toggles.ts`. Sin
  esa entrada el toggle no gatea la ruta y el cron corre con el módulo apagado.
- Ventana por defecto: 4 meses hacia atrás, mes en curso incluido. El barrido
  histórico completo se pide desde la UI con una fecha explícita.
- **Sin credenciales o con el sync apagado devuelve `disabled`, no `failed`**:
  reportarlo como error dispararía una alerta diaria por una integración que
  simplemente no está en uso.
- El botón manual llama la **misma** función, con el operador autenticado como
  importador. No requiere que la automatización esté encendida.

## Volumen real (al 2026-08-22)

| Período | Transacciones |
|---|---|
| 2025 | 110 |
| 2026 (a agosto) | 44 |
| **Total histórico** | **154** |

Primera `2025-10-01`, última `2026-08-18`. Un solo producto:
`Aramco ProForce Diesel B`. **Cero transacciones de AdBlue** (el endpoint
`cardsAdblue` lista 39 tarjetas, pero nunca se compró) y cero de gasolina. 17
patentes distintas de 39 vehículos registrados. Todo en MATRIZ; las dos sucursales
(Camiones, Camionetas) en 0.

Ese volumen es la razón de que el sync **no lleve estado**: el histórico completo
entra en una sola llamada, así que no hay cursor, ni lista de meses pendientes, ni
fila de estado con concurrencia optimista. La idempotencia la da `transactionId`.

## Lo que sigue en manos de una persona

- Configurar credenciales en producción y encender la automatización (queda
  apagada por defecto).
- Definir `ARAMCO_SYNC_IMPORTER_EMAIL`, o el cron falla sin a quién atribuir.
- Cruzar las 17 patentes que transaccionaron contra `fuel_vehicles` de producción:
  las que falten quedan pendientes de vinculación y su consumo no entra.
- **Vehículos**: los 39 están disponibles vía API, pero `fuel_vehicles` exige
  `equipmentTypeId` y `worksiteId` que Aramco no entrega. Debe entrar como preview
  reconciliable, no como alta automática.
- **AdBlue**: el mapeo está listo y probado (`ADBLUE-FLUA` → `fuel-bluemax`, sin
  migración), pero queda inerte hasta la primera compra. No hay forma de probarlo
  con datos reales hoy.
