# Aramco Fleet

## Estado: implementado y verificado localmente (2026-08-23).

La implementación local tiene pruebas de cliente, validación semántica, ledger,
proyección reconstruible y conciliación. Este documento no declara verificación de
producción ni una nueva llamada al portal.

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
- `lib/combustibles/fuel-provider-ledger.ts` — corrida durable, identidad externa y pendientes/rechazos.
- `lib/combustibles/fuel-reconciliation.ts` — matching conservador contra cargas internas.
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

**El producto tiene doble representación.** El ledger guarda FK a
`fuel_products` más `source_product`; como la proyección histórica
`fuel_consumption_records` no tiene columna de producto, además hay un lote por
(faena, mes, producto) y el producto viaja en `fuente`.
`products/main` **no es exhaustivo** —el único producto que la cuenta transó,
"Aramco ProForce Diesel B" (id 6), no aparece ahí— por eso la clasificación va por
nombre: ver `aramcoSourceForProduct`.

**La faena se deriva del vehículo.** Se busca la patente en `fuel_vehicles` con
`plateMatchKey`, que normaliza el formato con espacios de Aramco (`"SZ GB 72"` →
`"SZGB72"`). Las patentes que no están en el catálogo **no se pierden**: se
devuelven como pendientes para el flujo de vinculación existente.

El ledger relaciona Aramco con el proveedor canónico `fs-aramco`; no se infiere el
proveedor desde una etiqueta libre de `fuente` al conciliar.

## Mes en curso

El sync incluye el mes abierto para dar visibilidad del consumo del día. El
ledger se valida primero y la proyección se **reconstruye** cuando cambia el hash
de composición, tanto para meses abiertos como cerrados. Eso permite corregir
una transacción, retirar una transacción ausente de una respuesta posterior o
incorporar una carga tardía sin acumular duplicados.

Tres cuidados que el diseño respeta:

1. **El reemplazo conserva decisiones manuales.** La tabla
   `fuel_provider_mappings` guarda la relación proveedor/cuenta/patente externa
   → vehículo/faena fuera de la proyección. Al reconstruir, el UPDATE no envía
   `vehicle_id` cuando ya existe un vínculo manual.
2. **El hash no se basa sólo en totales.** Incluye identidad, fecha, patente,
   producto, cantidad y monto, por lo que una composición distinta con la misma
   suma sí se reconstruye.
3. **Una respuesta idéntica no reescribe el lote.** Si el hash no cambia, el
   lote queda intacto; si cambia, se reemplazan sus filas mediante la operación
   transaccional de `open-period.ts`, tanto si el mes está abierto como cerrado.

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
- En producción el Bearer no es suficiente: la ruta exige un origen presente en
  `CRON_ALLOWED_SOURCES` y aplica una ventana de rate limit. El proxy o runner
  debe enviar `X-Forwarded-For`/`X-Real-IP` de forma confiable.

## Ledger, pendientes y conciliación

Cada corrida crea una fila en `fuel_provider_sync_runs`. Cada movimiento usa
`transactionId` como identidad externa, conserva fingerprint y payload hash, y
queda `accepted`, `pending` o `rejected`. Producto desconocido, patente sin
vehículo, respuesta fuera de rango, números inválidos y duplicados no se mezclan
con «Otros» ni desaparecen en un log.

Una fila que no cumple el contrato de `movements` **no tumba la corrida**: se
registra como `source_row_invalid` en el ledger de rechazos y el resto se
importa igual (2026-08-28). Sólo si NINGUNA fila cumple el contrato se falla
ruidosamente, porque eso ya no es una fila corrupta sino un cambio de API. Un
`transactionId` repetido entre páginas con contenido idéntico se descarta en
silencio —la paginación del portal no es un snapshot—; si el contenido difiere,
va a revisión en vez de elegir uno de los dos.

Gasolina y kerosene tienen fuente propia (`Aramco Fleet Gasolina` /
`Aramco Fleet Kerosene`) y ficha en `fuel_products` desde la migración 0230.
Antes caían en «producto sin mapping canónico» y sus litros no llegaban a
ningún lote, con lo que el cajón `Aramco Fleet Otros` era inalcanzable; hoy ése
queda de red para lo que se acepte a futuro sin fuente propia. La pantalla muestra recibidas, aceptadas,
rechazadas, pendientes e impacto en litros/monto; la calidad se puede descargar
en Excel sin incluir el payload crudo.

La tabla `fuel_reconciliation_links` permite vincular una transacción a una
carga interna, un movimiento del ciclo físico y/o un DTE como evidencias
separadas. Una factura mensual puede cubrir N transacciones; una coincidencia
ambigua o fuera de tolerancia queda para decisión humana.

**La conciliación necesita la ficha del proveedor en `fuel_suppliers`.**
`decideFuelLoadMatch` exige `supplierId` en su primer filtro, así que sin ficha
TODA transacción queda `unmatched` — no por descuadre sino por catálogo
incompleto. La búsqueda reconoce `aramco`, `esmax` y `petrobras`, que son los
nombres bajo los que operación suele crearla; si aun así no la encuentra, la
corrida se cierra como `partial` con el motivo a la vista en vez de fabricar
`unmatched` en silencio.

Los lotes de la ventana que una corrida ya no respalda —un vehículo que cambió
de faena, o cargas que el proveedor retiró— se **vacían** (totales en cero,
registros eliminados), no se borran ni se marcan `revertido`. Antes conservaban
litros y monto para siempre, porque la reconstrucción por hash sólo visita los
grupos presentes en la respuesta.

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

Ese volumen hace innecesario un cursor de meses: el histórico completo entra en
una sola llamada y la idempotencia la da `transactionId`. Sí existe una corrida
durable en `fuel_provider_sync_runs`, con estado, métricas y correlación; lo que
no se persiste es una lista artificial de meses pendientes.

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
