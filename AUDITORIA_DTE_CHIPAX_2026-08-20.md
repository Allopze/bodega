# Auditoría integraciones DTE y Chipax — 2026-08-20

> ## ✅ Estado: REMEDIADO — 2026-08-20
>
> Los 64 hallazgos de este informe **están corregidos** (los 65 menos SEC-01, excluido por decisión explícita: `doc.env` se atiende aparte porque exige **rotar** credenciales, no un commit).
>
> **Verificación:** typecheck y lint limpios · **4414 pruebas en 515 archivos, 0 fallos** (eran 4359 antes de empezar) · migraciones 0194 y 0195 con la cadena verificada (196 entradas) · 97 archivos modificados, +4107 / −971, más 18 archivos nuevos.
>
> Quedan **10 diferidos** que no son código sino decisión de producto — el principal es el modelo N:1 de combustible (§CMP-06): se implementó la parte defensiva (una factura TAE que cubre N cargas dejó de contaminar el estado de la corrida) y falta decidir la tabla de unión. Los demás están marcados en sus respectivos hallazgos.
>
> Detalle en §8.

## 1. Veredicto

**Antes de cualquier hallazgo de las integraciones: `doc.env` está versionado en git con secretos de producción reales.** Contiene `AUTH_SECRET` (falsificación de sesión de cualquier usuario, incluido administrador), `CRON_SECRET` (el bearer que autentica los cinco crons de DTE y Chipax), la contraseña de Postgres, la API key de Resend y la de Copec. El guardia `npm run check:secrets` no lo ve porque filtra por nombres que *empiezan* con `.env`, y `doc.env` *termina* con eso. Toda la criptografía de sobres AES-GCM que audité en las dimensiones de credenciales —que es correcta— queda de adorno frente a alguien que ya tiene `AUTH_SECRET` y la clave de la base. Eso se atiende hoy y con rotación, no con un commit.

Dejando eso aparte: las dos integraciones están bien construidas en la frontera de confianza (SSRF cerrado, redacción de credenciales sólida, idempotencia por identidad tributaria, locks de corrida correctos) y mal construidas donde el dato ya es tuyo, en la aritmética de signo. Hay tres defectos que hoy calculan mal la plata —notas de crédito de venta guardadas en positivo, cargos bancarios propuestos como pago de facturas, y pagos negativos que marcan una factura como pagada— y ninguno es hipotético ni requiere que un proveedor cambie nada. La cuenta por cobrar es lo primero que se rompe: la NC de venta la infla al doble desde **ambos** proveedores, y una vez al mes las cartolas del último día se pierden para siempre porque el cron pide sólo el mes en curso.

En la ingesta de compra hay una fuga estructural que ninguna pantalla delata: la ventana móvil consulta por **fecha del documento**, no de recepción, así que un proveedor que envía una factura con más de dos meses de atraso deja un DTE que no se ingesta nunca, no se concilia nunca y no aparece en ningún Libro de Compras — y el evaluador de salud reporta `healthy`. Junto a eso, `estado_sii` se escribe siempre `null` mientras ocho lectores lo consumen (incluida la columna «Estado SII» de la exportación tributaria), y `estado_plataforma` sí se puebla pero no lo lee nadie: un DTE reclamado en el portal se auto-concilia igual que uno aceptado.

La deuda estructural está en la conciliación de compra: el lado OC tiene tres capas de defensa (lock, guarda de ocupación, índice único) y el lado combustible no tiene ninguna, además de ser estructuralmente incapaz de conciliar el caso normal (una factura TAE mensual cubre 40 cargas y el modelo es 1:1).

Y en recuperación ante desastre las dos integraciones están muertas por diseño: el respaldo guarda religiosamente los sobres cifrados y **descarta la llave** —`DTE_SETTINGS_KEYRING` no está en la whitelist del orquestador— mientras que, en el otro extremo, el snapshot que sí lleva la llave la sube a Google Drive sin cifrar, en el mismo tar que el dump que esa llave abre.

Lo que más daño hace sin ser un bug: `reconciliationStatus` es estructuralmente `partial` en producción, así que el módulo emite tres alertas diarias permanentes con el mismo código y el mismo texto que usaría una pérdida real de documentos del libro de compras. Cuando falten DTE de verdad, nadie lo va a ver.

## 2. Mapa de la integración

```
COMPRA (portal FacturaEnLínea)
  cron 07/13/19 ─► sync.ts ─► claimDteSyncStart ─► client.get(PNC_PanelCorreo.php)
                                                        │
                              parseBandejaResult ◄──────┘  (parser.ts: splitTopLevelTdCells,
                                                            parseMonto, parseFechaPortal)
                                     │
                    upsertDteDocument (1 tx por fila) ─► dte_documents
                                     │
                    summarizeDteReconciliation
                       ├─ matchToPurchaseOrderInvoices ─► purchase_order_invoices  (OC)
                       └─ matchToFuelLoads             ─► fuel_loads               (combustible)
                                     │
        bajo demanda ── downloadDteDocumentXml ─► monto_neto / iva / xml_path
                                     │
        salidas: /compras/dte · dte-libro-compras · dte-conciliacion · dashboard Flota/Finanzas

VENTA (Chipax + FacturaEnLínea)
  cron 09:00 chipax ─► syncBillingInvoices(actual, anterior) ─► providers/chipax.ts /dtes
  cron 07:30 fel    ─► syncBillingInvoices ─► factura-en-linea.ts ─► enrichFromXml (dte-xml.ts)
                                     │
                       upsertProviderInvoice ─► billing_invoices + billing_external_refs
                                     │
  cron 09:00 chipax ─► syncBankTransactions(SÓLO actual) ─► billing_bank_transactions
                                     │
                       proposeMatches / generatePaymentSuggestions ─► billing_invoice_payments
                                     │
                       recomputeInvoicePaymentStatus ─► payment_status / paid_amount
                                     │
        salidas: /facturacion/cobranza · billing-cobranza.xlsx · dashboard Finanzas
```

**Quién gobierna cada tramo**

| Tramo | Archivos |
|---|---|
| Transporte y origen | `lib/services/dte-portal/{client,portal-origin,download,config}.ts` |
| Parseo HTML | `lib/services/dte-portal/{parser,bandeja-entrada}.ts` |
| Orquestación / locks | `lib/services/dte-portal/{sync,sync-start-gate,operation-lease,cron-contract,health,health-alerts}.ts` |
| Conciliación compra | `lib/services/dte-portal/reconciliation.ts`, `lib/services/purchasing-module/{invoices,dte-candidates}.ts` |
| Credenciales | `lib/services/dte-portal/{settings,settings-crypto}.ts`, `lib/services/billing/chipax-settings.ts` |
| Proveedores venta | `lib/services/billing/providers/{chipax,factura-en-linea,manual}.ts`, `dte-xml.ts` |
| Motor venta | `lib/services/billing/{sync,invoices,sales-xml-cursor}.ts` |
| Dinero | `lib/services/billing/{money,reconciliation,collections,duplicates,queries}.ts` |
| Salidas | `lib/reports/export-module/{dte-libro-compras,dte-conciliacion,dte-facturas-sin-oc,billing-cobranza}.ts`, `app/(app)/compras/dte/page.tsx`, `app/(app)/dashboard/sections/{finance,fleet}-section.tsx` |

## 3. Hallazgos

*65 hallazgos: 1 CRITICAL, 5 P1, 23 P2, 36 P3. Cada uno pasó por un verificador adversarial cuyo trabajo era refutarlo; los descartados están en §5 para que no se vuelvan a levantar.*

### CRITICAL

---

### [SEC-01] `doc.env` está versionado en git con secretos de producción reales, y el guardia anti-fuga no lo ve — CRITICAL
**Dónde:** `doc.env` (rastreado desde el commit `2337b97`) · `scripts/check-env-files.ts:17` · `.gitignore:50`

**Qué pasa:** El archivo está en el árbol de git con valores reales, no plantillas. Verificado en este checkout:

```bash
$ git ls-files --error-unmatch doc.env      # → doc.env  (rastreado)
$ git check-ignore -v doc.env               # → (sin salida: NO ignorado)
$ grep -oE '^(AUTH_SECRET|CRON_SECRET|POSTGRES_PASSWORD|RESEND_API_KEY|COPEC_PASSWORD)=.+' doc.env | cut -d= -f1
AUTH_SECRET
POSTGRES_PASSWORD
RESEND_API_KEY
CRON_SECRET
COPEC_PASSWORD
```

Las dos barreras que deberían haberlo impedido fallan por la misma razón — comparan contra el **principio** del nombre:

```ts
// scripts/check-env-files.ts:17
const trackedEnvFiles = getTrackedFiles().filter((file) => file === ".env" || file.startsWith(".env."))
```
`doc.env` no es `.env` ni empieza por `.env.`, así que `npm run check:secrets` pasa en CI con el archivo dentro. `.gitignore:50` (`.env*`) falla igual: el patrón se compara contra el basename completo. Y el propio archivo se presenta como plantilla vacía en su cabecera — «PLANTILLA DE VARIABLES DE ENTORNO … Rellena los valores de tu entorno» — mientras carga cinco valores reales.

**Cómo se rompe:** Cualquiera con lectura del repositorio, de un clon, de un fork o del historial obtiene `CRON_SECRET` y, del mismo archivo, `APP_URL`. Con eso: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<APP_URL>/api/cron/dte-portal-sync` dispara a voluntad raspados del portal con las credenciales tributarias de la empresa —y lo mismo con `/api/cron/chipax-sync` y los otros 17 crons. `AUTH_SECRET` es peor: permite firmar una sesión NextAuth de cualquier usuario, incluido el titular de `admin:dte_sync` y `billing:manage_sync`.

**Impacto:** Compromiso total, no acotado a estas integraciones: suplantación de sesión de administrador, acceso directo a la base con toda la evidencia tributaria, disparo remoto de las integraciones y agotamiento o bloqueo de la cuenta del portal DTE. Es la única razón por la que este hallazgo va antes que los tres defectos de dinero.

**Arreglo:** En este orden — (1) **rotar** los cinco secretos, que es lo urgente y lo único que la remoción no logra por sí sola; (2) `git rm --cached doc.env` y añadirlo a `.gitignore`; (3) purgar el blob del historial con `git-filter-repo` si el repositorio salió alguna vez de tu control; (4) ampliar el filtro de `check-env-files.ts:17` a una expresión que capture cualquier `*.env` rastreado salvo `.env.example`, para que CI rompa la próxima vez.

> Nota de alcance: este hallazgo lo levantó el crítico de completitud, fuera de la superficie DTE/Chipax, pero entra de lleno porque `CRON_SECRET` es exactamente lo que protege los cinco crons de estas dos integraciones. `AUDITORIA_HARDCODEADOS.md:31` ya lo había clasificado como crítico en su momento y el archivo sigue ahí.

---

### P1

---

### [BKP-01] El respaldo descarta `DTE_SETTINGS_KEYRING`: un restore catastrófico deja los secretos cifrados ilegibles para siempre — P1
**Dónde:** `scripts/backup-orchestrator.sh:187-201`

**Qué pasa:** La whitelist de variables que el orquestador respalda no contiene **ninguna** `DTE_*`, `CHIPAX_*` ni `BILLING_*`:

```bash
ENV_WHITELIST=(
  NODE_ENV HOSTNAME
  DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD PGHOST
  AUTH_SECRET AUTH_SECRET_PREVIOUS AUTH_URL NEXTAUTH_URL
  APP_URL PDF_RENDER_ORIGIN
  RESEND_API_KEY
  ...
  COPEC_USERNAME COPEC_PASSWORD COPEC_SYNC_START_DATE
  ...
)
```

El secreto de las credenciales del portal y de Chipax **no está en la base**: en la base están los sobres `enc:v1:<kid>:…` y la llave vive sólo en `DTE_SETTINGS_KEYRING`. El respaldo guarda el ciphertext (`postgres.dump`) y tira la llave. La pérdida es irreversible por diseño: `settings.ts:175-179` lanza `DTE_SETTINGS_ENVELOPE_INVALID` bajo `encryption_mode=encrypted_only`, y esa barrera durable sobrevive al dump, así que tampoco hay caída al `.env`.

Hay una rama que salva el caso: `backup-orchestrator.sh:203` copia el `.env` entero **si existe `/srv/bodega/.env`**. En el despliegue actual la aplicación no vive en esa ruta y las variables llegan por `environment` del compose, así que la rama que corre es la de la whitelist.

**Cómo se rompe:** Se pierde el servidor y se corre `scripts/catastrophic-restore.sh` sobre un host nuevo — el escenario para el que ese script existe. Postgres vuelve con `system_settings` lleno de sobres y con `encryption_mode=encrypted_only`; el `.env` reconstruido no trae el keyring. `decodeStoredDteSettings` lanza `DTE_SETTINGS_KEYRING_REQUIRED` en cada lectura: el cron DTE queda `failed` permanente, `/compras/dte` y el Libro de Compras revientan (`dte-libro-compras.ts:19` llama `readDtePortalConfig()` sin `try`), y la sección Flota del dashboard cae con ella (API-01).

**Impacto:** Un restore deja las dos integraciones tributarias muertas y no autorrecuperables —sin Libro de Compras, sin conciliación DTE↔OC, sin cuentas por cobrar— justo en el momento de desastre. Recuperarlas exige que alguien haya guardado la llave fuera del sistema de respaldo, cosa que ninguna documentación pide.

**Arreglo:** Añadir a `ENV_WHITELIST` las variables que `docker-compose.yml` inyecta al servicio `app` (`DTE_SETTINGS_KEYRING`, `DTE_SETTINGS_ACTIVE_KEY_ID`, `DTE_SETTINGS_MODE`, `DTE_PORTAL_*`, `DTE_SYNC_*`, `BILLING_*`, `CHIPAX_*`). Mejor: derivar la lista de `.env.example` y dejar una prueba que falle si una variable del compose no está respaldada — mantenerla a mano es lo que produjo el hueco.

---

### [BKP-02] El snapshot sube a Drive, sin cifrar, la llave del keyring junto al dump que esa llave abre — P1
**Dónde:** `scripts/backup-orchestrator.sh:203-207, 228, 241, 269, 345`

**Qué pasa:** Cuando el `.env` físico sí existe, se copia entero al tar de configuración —keyring incluido— y junto a él van `rclone.conf` (`:228`) y `gdrive-service-account.json` (`:241`). El conjunto se empaqueta con `tar -czf` (`:269`), **sin gpg ni age**, y se sube al mismo directorio de Drive que el `postgres.dump` (`:345`).

El cifrado de sobres de `settings-crypto.ts` protege contra un volcado de base. Ese modelo de amenaza se anula cuando la llave viaja en el mismo archivo comprimido que el volcado. Y como el tar lleva además las credenciales del propio destino, quien obtenga **un** snapshot obtiene acceso a **todos** los retenidos (30 días por defecto).

**Cómo se rompe:** Se comparte por error la carpeta `gdrive-backups:bodega-backups`, o se compromete la cuenta de Drive. El atacante descomprime `env-config.tar.gz`, lee `DTE_SETTINGS_KEYRING` y descifra del dump la clave del portal FacturaEnLínea y `CHIPAX_SECRET_KEY`. Con la clave del portal entra a `clientes.dtefacturaenlinea.cl` como la empresa: todo el historial tributario, emisión incluida. De paso obtiene `AUTH_SECRET`, `POSTGRES_PASSWORD`, `CRON_SECRET` y el service account que le entrega los otros 29 snapshots.

**Impacto:** Un solo incidente de acceso al respaldo entrega credenciales tributarias vivas, la base completa y el pivote a todo el histórico. Misma clase de exposición que SEC-01, con vida útil de 30 días y sin dejar rastro en git.

**Arreglo:** Cifrar el snapshot antes de subirlo (`rclone crypt` en el remoto, o `age`/`gpg --symmetric` sobre los artefactos) con una passphrase que **no** viaje dentro del propio snapshot, y sacar `rclone.conf` y `gdrive-service-account.json` del tar que se sube al destino que ellos mismos protegen.

---

### [CHX-01] Las notas de crédito de venta se guardan con monto positivo y suman a la cuenta por cobrar — P1
**Dónde:** `lib/services/billing/providers/chipax.ts:342` y `lib/services/billing/providers/factura-en-linea.ts:312,343`

**Qué pasa:** `mapDte` copia los montos sin mirar `dte.tipo`:
```ts
netAmount: numberOrNull(dte.montoNeto),
taxAmount: numberOrNull(dte.iva),
exemptAmount: numberOrNull(dte.montoExento),
totalAmount: dte.montoTotal,
```
La convención está escrita en tres lugares (`db/schema/billing.ts:74` «Negativo en notas de crédito»; `invoices.ts:490`; `dte-xml.ts:99` con `asCredit = docType === "61" ? v => -Math.abs(v) : v`) y sólo se materializa por la vía manual (XML). Ni Chipax ni FEL invierten `totalAmount`, y `enrichFromXml` (factura-en-linea.ts:230-236) sólo pisa neto/IVA/exento, nunca el total. Aguas abajo no hay guardia: `upsertProviderInvoice` inserta tal cual y no hay check constraint de signo.

**Cómo se rompe:** `/dtes` devuelve `{tipo: 61, folio: 4321, montoTotal: 1190000}` (NC que anula una factura). Se inserta `total_amount = +1.190.000`, `payment_status = 'unpaid'`. La cuenta por cobrar del cliente queda 1.190.000 más alta en vez de 1.190.000 más baja: error de 2.380.000. Efecto secundario: neto/IVA/exento hacen ping-pong entre corridas (FEL los deja negativos vía XML, Chipax los devuelve a positivo), con un `invoice.updated_from_provider` por vuelta.

**Impacto:** Aging y cartera inflados en 2× cada NC de venta; cobranza persigue descuentos; el facturado del mes que se reporta a gerencia queda sobredeclarado. La corrida cierra `success`.

**Arreglo:** Exportar `asCredit` desde `dte-xml.ts` y aplicarlo en **un solo punto compartido** — `upsertProviderInvoice`, que es por donde pasan los tres proveedores. Parchar sólo `mapDte` deja el mismo error entrando por FEL.

---

### [CHX-02] El cron sólo pide cartolas del mes en curso: los movimientos del último día posteriores a las 09:00 no se consultan nunca más — P1
**Dónde:** `app/api/cron/chipax-sync/route.ts:58`

**Qué pasa:** Las ventas sí van dos veces (`const periods = [current, previousBillingPeriod(current)]`, líneas 39-53), pero las cartolas se piden una sola vez con `period: current`. `listBankTransactions` filtra `startDate=${period}-01` / `endDate=endOfMonth(period)` y el scheduler corre una vez al día (`docker-compose.yml:217`, `0 9 * * * cron-runner.mjs chipax`). Al cambiar el mes, el rango anterior deja de consultarse para siempre. El conector bancario publica con 1-3 días de retraso, así que la ventana perdida es mayor que 15 horas.

**Cómo se rompe:** 31/08 09:00 pide 2026-08-01..08-31. A las 15:40 el cliente paga 4.998.000 y Chipax registra el movimiento con fecha 2026-08-31. El 01/09 09:00 pide 2026-09-01..09-30. Ninguna corrida vuelve a pedir agosto: el abono nunca entra a `billing_bank_transactions` y la factura queda `unpaid` y entra a mora estando pagada.

**Impacto:** Pérdida silenciosa y mensual de la única fuente de movimientos bancarios. Facturas pagadas reportadas como morosas.

**Arreglo:** Mover `syncBankTransactions` dentro del `for (const period of periods)` existente. Idempotente por `onConflictDoNothing` sobre `(provider, external_id)`. Nota: el alcance actual es deliberado (comentario del route + aserción en `route.test.ts:83`), así que hay que actualizar la prueba.

---

### [MON-02] La conciliación propone cargos bancarios (plata que salió) como pago de facturas de venta — P1
**Dónde:** `lib/services/billing/reconciliation.ts:114` y `:250-263`

**Qué pasa:** `proposeMatches` compara magnitudes y nunca mira el signo:
```ts
const exactAmount = amountsWithinTolerance(absAmount(available), absAmount(outstanding), options.amountTolerance)
```
`mapCartola` construye el monto como `(row.abono ?? 0) - (row.cargo ?? 0)` (chipax.ts:357-376), así que los cargos entran negativos, y `generatePaymentSuggestions` los selecciona con `amount <> allocated_amount`, sin filtro de signo. Como la cartola no trae contraparte (`counterpartyTaxId: null`), no se genera warning y la confianza queda `medium` con monto+fecha. `assertAllocationFits` (línea 407) también usa `absAmount` en ambos lados. Y el panel de sugerencias (`collections.ts:300-318`, `suggestions-panel.tsx`) **no muestra el monto ni la glosa del movimiento**: quien confirma no puede ver que era un cargo.

**Cómo se rompe:** Factura 2001, saldo 1.190.000, vencida hace 10 días. En la cartola hay un pago a proveedor de 1.190.000 → fila con `amount = -1.190.000`. `abs` iguales, dentro de los 60 días → sugerencia `medium` sin warnings. Cobranza confirma; `matchedAmount = +1.190.000`, la factura queda `paid` y el cargo con `allocated_amount = 1.190.000`.

**Impacto:** Cuenta por cobrar viva dada por cobrada contra una salida de caja. Desaparece del aging y de la cartera, y la conciliación bancaria queda cuadrada contra el signo opuesto. Con ±1.000 CLP de tolerancia y 60 días de ventana, cualquier cargo parecido es candidato.

**Arreglo:** Filtro de signo en `generatePaymentSuggestions` (`direction === 'sale'` → `amount > 0`; `'purchase'` → `< 0`) y descarte en `proposeMatches` cuando `Math.sign(available) !== Math.sign(outstanding)` — así quedan cubiertas también las NC (outstanding negativo ↔ cargo negativo). Test en `reconciliation.test.ts` con movimiento negativo contra factura positiva.

---

### P2

---

### [ING-03] La ventana móvil filtra por fecha del DOCUMENTO, no de recepción: un DTE enviado con atraso no se ingesta nunca — P2
**Dónde:** `lib/services/dte-portal/bandeja-entrada.ts:59-63` · `lib/services/dte-portal/sync.ts:484-487`

**Qué pasa:** La consulta a la bandeja se parametriza por la fecha de emisión del documento:
```ts
cbxMesDocumento: filter.mes,
cbxAnioDocumento: filter.anio,
```
y la ventana automática son dos períodos: `rollingSyncPeriods()` → `[current, previousPeriodo(current)]`. Pero un documento entra a la bandeja cuando el **proveedor lo envía**, que puede ser meses después de emitirlo. Para encontrarlo hay que consultar el mes de su *emisión*, así que la puerta se cierra a los 30-60 días. `fechaRecepcion` se raspa (`bandeja-entrada.ts:176`) y se descarta: ni siquiera queda el dato para medir el retraso o justificar un re-barrido.

**Cómo se rompe:** Un proveedor emite la factura 33 con fecha 2026-05-28 por $8.000.000 y la envía al portal el 2026-08-10 (caso corriente: acumula y envía al cierre de contrato). El 10 de agosto `rollingSyncPeriods()` = `["2026-08","2026-07"]`, así que nadie vuelve a consultar `cbxMesDocumento=05`. El documento se queda en la bandeja indefinidamente: no entra a `dte_documents`, su OC queda «sin factura» para siempre, y no aparece en el Libro de Compras de ningún mes. El evaluador de salud —que sólo exige mes actual y anterior— reporta `healthy`.

**Impacto:** Pérdida silenciosa y permanente de crédito fiscal de IVA y de evidencia tributaria, sin señal en pantalla, log ni alerta. Se descubre cuando el proveedor reclama el pago, o al cuadrar el F29 contra el portal a mano. La recuperación exige que alguien sospeche y lance un `force` por período viejo, cosa que nada programa ni sugiere.

**Arreglo:** Persistir `fecha_recepcion` (ya viene parseada) y añadir un barrido mensual que re-consulte con `force` los N períodos anteriores comparando `tbxTotalRegistros` del portal contra el conteo local; discrepancia = alerta a los titulares de `admin:dte_sync`, igual que ya hace `notifyDteSyncHealthChange`.

---

### [ING-01] `estado_plataforma` se raspa y se persiste, pero no lo lee nadie: un DTE reclamado se concilia igual que uno aceptado — P2
**Dónde:** `lib/services/dte-portal/sync.ts:423` (insert) y `:398` (update)

**Qué pasa:** La columna se puebla y hasta participa de `computeDocumentHash` (`sync.ts:348`), así que un cambio de estado dispara un UPDATE — pero un grep de `estadoPlataforma|estado_plataforma` fuera de tests devuelve **sólo escrituras**. `types.ts:154` muestra que el portal distingue `ENV`/`PEN`/`BLO` (enviado, pendiente, bloqueado) y `sync.ts:188` pide explícitamente todos los estados. Es el único indicador de aceptación que la Bandeja entrega por documento, y el pipeline lo trata como decorativo: `matchToPurchaseOrderInvoices` filtra por tipo, fecha y RUT, nunca por estado, y `validateDteForInvoiceTx` tampoco.

**Cómo se rompe:** Un proveedor emite la factura 33 folio 9001 por $4.500.000 contra un RUT que calza con una OC abierta; la empresa la **reclama** en el portal (mercadería no recibida) y queda en estado bloqueado. La corrida siguiente la ingesta con ese `estado_plataforma` y acto seguido la auto-vincula, porque tipo, RUT y fecha calzan. La OC queda «facturada», el documento entra al Libro de Compras del período, y ninguna pantalla muestra que está reclamado.

**Impacto:** Se registra crédito fiscal de IVA sobre un documento reclamado y se da por facturada una OC que no lo está. Sólo aparece al cruzar contra el portal a mano, típicamente en la declaración mensual.

**Arreglo:** Excluir del auto-matching los documentos cuyo `estado_plataforma` no sea el aceptado —o como mínimo marcarlos `ambiguous` en vez de vincular—, exponer la columna en `/compras/dte` y en el Libro de Compras, y añadirla a `validateDteForInvoiceTx`.

---

### [ING-02] `estado_sii` se escribe siempre `null` y ocho lectores lo consumen, incluida la columna «Estado SII» de la exportación tributaria — P2
**Dónde:** `lib/services/dte-portal/sync.ts:421`

**Qué pasa:** La única asignación en todo el repositorio es literal:
```ts
estadoSii: null,   // …quedan null hasta que exista una fuente real para ellos
```
El UPDATE (`sync.ts:394-403`) tampoco lo toca. Verificado: `grep -n estadoSii lib/services/dte-portal/sync.ts` devuelve esa sola línea. Pero la superficie de consumo se construyó como si el dato llegara — hay 8 lectores no-test, entre ellos `dte-libro-compras.ts:47,57` (que publica la columna «Estado SII» en la exportación), las cinco ramas de badge de `compras/dte/page.tsx:138-142`, y el desglose de siete categorías de `computeHealthStats` en `reconciliation.ts:573-591`. El único ingestor es la Bandeja de Entrada, que no trae estado SII.

**Cómo se rompe:** Contabilidad exporta el Libro de Compras de julio para cuadrar el F29. Las 578 filas traen «Sin estado SII» en la última columna, además de Neto e IVA vacíos (CMP-05). Quien abre `/compras/dte` ve el guion en el 100% de las filas y concluye que el portal dejó de entregar el estado, cuando la plataforma nunca lo pidió. `computeHealthStats(...).estadoSii` devuelve `{aceptado:0, …, sinEstado:578}` para cualquier período.

**Impacto:** La exportación tributaria y la pantalla de documentos prometen un dato de validez que estructuralmente no existe, e inducen a leer «sin estado» como problema del portal en vez de laguna de la integración. Mantiene ~30 líneas de UI y estadística que ninguna prueba puede ejercitar.

**Arreglo:** Decidir en un sentido u otro: poblar `estado_sii` desde una fuente real (el panel de ventas del portal sí lo expone) o eliminar la columna del export, las cinco ramas de badge y el bloque `estadoSii` de `computeHealthStats`, reemplazándolos por `estado_plataforma`, que sí llega poblado (ING-01).

---

### [DOC-01] El runbook de rollback está desactualizado: su Nivel 4 deja `billing_invoice_payments` sin el estado `reverted` que el código escribe — P2
**Dónde:** `docs/facturacion/ROLLBACK.md:65`

**Qué pasa:** El SQL publicado retira un solo tag:
```sql
DELETE FROM drizzle.__drizzle_migrations WHERE tag = '0136_billing_module';
```
Se escribió cuando 0136 era la última migración de facturación. Hoy hay al menos cuatro posteriores que tocan esas tablas: `0140_white_darwin.sql` hace `DROP CONSTRAINT billing_invoice_payments_status_valid` y lo recrea incluyendo `'reverted'`, que es exactamente lo que escribe `reconciliation.ts:534`. Además la premisa del documento («cero columnas agregadas o modificadas», ROLLBACK.md:8-11) ya no es cierta para `dte_documents`/`dte_sync_runs`, que recibieron columnas en 0153/0156/0159.

**Cómo se rompe:** Alguien ejecuta el bloque del Nivel 4 —procedimiento oficial, publicado y aparentemente probado— y luego `npm run db:migrate`. Drizzle reaplica 0136 (su tag se borró) y **salta** 0140 (su tag sigue). `billing_invoice_payments` queda con el CHECK de tres valores. La primera vez que un operador usa «Revertir» sobre un pago mal imputado, Postgres lanza `violates check constraint "billing_invoice_payments_status_valid"`: la reversión es imposible y el saldo de la factura queda permanentemente equivocado.

**Impacto:** El único procedimiento documentado de reversión deja la base en un estado silenciosamente inconsistente que rompe justo la operación que hace falta después de un rollback.

**Arreglo:** Retirar en el Nivel 4 todos los tags de facturación aplicados (0136, 0140 y posteriores que toquen tablas `billing_*`) y corregir la sección de reversibilidad enumerando lo que 0140/0153/0156/0159 añadieron. Idealmente reemplazar el SQL a mano por un script versionado con una prueba que lo ejecute contra una base efímera.

---

### [MON-01] Un pago negativo por el total marca la factura como pagada — P2
**Dónde:** `lib/services/billing/invoices.ts:492-511`

**Qué pasa:** `derivePaymentStatus` toma valor absoluto de la **suma consolidada** de pagos y la compara contra el absoluto del total, sin exigir mismo signo. El `abs` existe para NC (total negativo cubierto por pago negativo), pero aplicado a la suma hace que una suma negativa sobre un total positivo se lea como cobertura completa. `manualPaymentSchema` (`cobranza/actions.ts:141`) sólo exige `amount !== 0` y el check de BD es `amount <> 0`; la única guardia extra es exigir nota cuando el monto es negativo.

**Cómo se rompe:** Factura 33/1234, total 1.190.000, sin pagos. Ajuste por devolución de -1.190.000 → `paid = abs(-1.190.000) = 1.190.000`, `compareAmounts === 0` → `paymentStatus = 'paid'` con `paidAmount = -1.190.000` persistido. Igual con `[+600.000, -1.600.000]` sobre un total de 1.000.000.

**Impacto:** La factura sale de `getCollectionsView.totalOutstanding`, de `getBillingSummary.outstandingByCurrency/overdueByCurrency` y de `generatePaymentSuggestions`. Además el `paidAmount` negativo resta en `collected`/`invoicedByCurrency` y la columna Saldo muestra 2.380.000 en una fila rotulada «Pagada».

**Arreglo:** Comparar con signo: `const sign = totalAmount < 0 ? -1 : 1` aplicado a `paidAmount` antes de comparar; si el resultado es negativo → `unpaid` con `outstandingAmount = |total| + |paid|`. Caso `derivePaymentStatus(1190000, [-1190000]) → 'unpaid'` en `invoice-rules.test.ts`.

---

### [MON-03] El facturado por cliente y por faena se duplica cuando una factura tiene más de un vínculo — P2
**Dónde:** `lib/services/billing/queries.ts:647-680`

**Qué pasa:** Ambas agregaciones hacen `innerJoin(billingInvoiceLinks, ...)` y suman `billingInvoices.totalAmount` — el total completo — ignorando `billingInvoiceLinks.amount` («Porción del total imputada a este vínculo»). `billing_invoice_links` es N-a-N a propósito y no tiene unique por factura; `linkInvoiceAction` (`facturacion/actions.ts:176-240`) inserta un vínculo por llamada, nacido `confirmed`, sin comprobar previos.

**Cómo se rompe:** Factura de 10.000.000 que cubre dos meses de servicio → dos vínculos confirmados. `topClients = [{Minera X, 20000000}]`, `byWorksite = [{Faena Norte, 20000000}]`, mientras `invoicedByCurrency` (que no cruza vínculos) dice 10.000.000. Con vínculos a clientes distintos, el total íntegro se imputa a cada uno.

**Impacto:** Hojas «Por cliente» y «Por faena» de `lib/reports/export-module/billing-cobranza.ts:96,101` y el tablero informan hasta N× el facturado real, contradiciendo el total del mismo resumen.

**Arreglo:** Agregar sobre una porción no duplicada: `coalesce(links.amount, invoices.total_amount / count(*) OVER (PARTITION BY invoice_id))`, o deduplicar por factura en un CTE antes del join. Caso multivínculo en `queries-scope.test.ts`.

---

### [MON-04] Un cambio de total desde el proveedor no recalcula el estado de pago — P2
**Dónde:** `lib/services/billing/invoices.ts:313-345`

**Qué pasa:** `upsertProviderInvoice` es el único camino que escribe `total_amount` y jamás llama a `recomputeInvoicePaymentStatus`; `syncBillingInvoices` tampoco. Todos los demás caminos que tocan dinero sí lo hacen (`reconciliation.ts:500/559`, `duplicates.ts:398`, `cobranza/actions.ts:233`). `paymentStatus`/`paidAmount` son caché derivada del total.

**Cómo se rompe:** Factura con total 1.000.000 y un pago confirmado de 1.000.000 → `paid`. El proveedor reporta el documento corregido en 1.500.000: se escribe el total y queda `paid` con `paidAmount = 1.000.000`.

**Impacto:** 500.000 realmente pendientes invisibles (`ne(paymentStatus,'paid')` los excluye del saldo, del vencido y de las sugerencias). En el caso inverso, una factura sobrepagada no se marca `overpaid` y nadie detecta la devolución.

**Arreglo:** Tras el `tx.update`, `if (changedFields.includes("totalAmount")) await recomputeInvoicePaymentStatus(tx, existing.id)`. Ya está importado y es idempotente.

---

### [REC-01] Cancelar o eliminar una OC deja el DTE vinculado y sin ninguna ruta de desvinculación — P2
**Dónde:** `lib/services/purchasing-module/invoices.ts:424` · `lib/services/purchasing-module/purchase-orders-status.ts:122`

**Qué pasa:** `INVOICE_ALLOWED_STATUSES` incluye `sent`, y `cancelOrder` acepta `draft|sent` (`DELETABLE_ORDER_STATUSES` igual). Ni `cancelOrder` ni `deleteOrder` tocan `purchase_order_invoices` ni `dte_documents` (`deleteOrder` es soft-delete, así que el cascade nunca se dispara). La única desvinculación del repo fuera de scripts es `deletePurchaseOrderInvoice` (`invoices.ts:431`, `set({purchaseOrderInvoiceId: null})`), y se auto-bloquea porque la OC ya está en `cancelled`.

**Cómo se rompe:** OC en `sent` con factura 8123456 y su DTE vinculado. Se cancela la OC (permitido). `deletePurchaseOrderInvoice` lanza «No se puede eliminar la factura de una OC en estado 'cancelled'»; el `uniqueIndex dte_documents_purchase_invoice_single_unique` y la guarda `occupied` impiden re-vincular; `selectDteCandidates` ya no lo ofrece (exige `isNull(purchaseOrderInvoiceId)`). La OC correcta nunca recibe su documento.

**Impacto:** Evidencia tributaria atrapada en una OC anulada, que `dte-conciliacion` sigue exhibiendo como conciliada. Reparable sólo por SQL.

**Arreglo:** Relajar la guarda de estado de `deletePurchaseOrderInvoice` (donde ya vive el `set({purchaseOrderInvoiceId: null})`), no duplicar lógica en `cancelOrder`/`deleteOrder`.

---

### [REC-02] El conciliador automático vincula DTE a facturas de OC canceladas o soft-deleted — P2
**Dónde:** `lib/services/dte-portal/reconciliation.ts:186-200`

**Qué pasa:** La consulta de facturas candidatas trae `purchaseOrder` sólo para leer `supplier.rut` y no filtra `status <> 'cancelled'` ni `isNull(deletedAt)`. Drizzle no aplica filtros globales de soft-delete y `deleteOrder` no borra filas, así que las facturas de una OC muerta siguen siendo destino válido. `linkDteToPurchaseOrderInvoice` sólo verifica ocupación del lado DTE/factura, nunca el estado de la orden.

**Cómo se rompe:** OC en `sent` con factura 8123456 cargada a mano; se cancela. Tres horas después el cron encuentra el DTE 33/8123456 sin vincular y la factura de la OC cancelada (folio+RUT calzan) → lo vincula. Cuando Compras crea la OC correcta con la misma factura, `matchInvoiceToDteDocument` devuelve null y la guarda `occupied` bloquea el reintento.

**Impacto:** El DTE de una compra viva se consume automáticamente contra una orden anulada; combinado con REC-01, el vínculo es irreversible desde la app. Sólo queda un `logger.warn`.

**Arreglo:** `innerJoin`/`where` sobre la orden en `matchToPurchaseOrderInvoices`: `status <> 'cancelled' AND deleted_at IS NULL`. (`matchInvoiceToDteDocument` no necesita cambio: sólo se invoca desde `createPurchaseOrderInvoice`, tras el `FOR UPDATE` y el gate de estado.)

---

### [REC-03] `matchToFuelLoads` no tiene guarda de ocupación ni índice único: dos DTE pueden colgar de la misma carga — P2
*(consolida el hallazgo equivalente de la dimensión Compras/Combustibles)*

**Dónde:** `lib/services/dte-portal/reconciliation.ts:522-529` · `db/schema/dte.ts:140`

**Qué pasa:** El lado OC tiene transacción + `SELECT ... FOR UPDATE` + consulta de ocupación + `uniqueIndex dte_documents_purchase_invoice_single_unique`. El lado combustible tiene un UPDATE suelto:
```ts
const linked = await db.update(dteDocuments).set({ fuelLoadId: load.id }).where(and(
  eq(dteDocuments.id, doc.id),
  isNull(dteDocuments.purchaseOrderInvoiceId),
  isNull(dteDocuments.fuelLoadId),
)).returning({ id: dteDocuments.id })
```
Las guardas `isNull` sólo comprueban que **el documento** esté libre, no la carga. Sobre `fuel_load_id` sólo existe `index("dte_documents_fuel_load_idx")` (verificado en `db/migrations/0133_gigantic_hex.sql:65`: `CREATE INDEX`, no `UNIQUE`). El check `dte_documents_single_business_link` sólo impide que un DTE apunte a los dos dominios. La consulta de `loads` (:482) no excluye cargas ya vinculadas y el mapa de ambigüedad se arma sólo con documentos del período en curso.

**Cómo se rompe:** Carga L (Copec, boleta 88123) vinculada al DTE 33/88123 en julio. En agosto alguien corrige `receiptNumber` a 88124 (ver REC-07). El sync de 2026-08 encuentra el DTE 33/88124 de Copec sin vincular, calza contra L y ejecuta el UPDATE: L queda con dos DTE. `computeHealthStats.matchedToFuel` cuenta 2 para una compra y `countDiscrepancies` marca la diferencia.

**Impacto:** Dos documentos tributarios contradictorios sobre una misma carga, sin barrera de BD y sin ruta de reparación (`repair-dte-single-link.ts` agrupa por `purchaseOrderInvoiceId`, no por `fuelLoadId`).

**Arreglo:** Extraer un `linkDteToFuelLoad` espejo del lado OC (tx + `FOR UPDATE` sobre `fuelLoads` + consulta de ocupación) y agregar `uniqueIndex("dte_documents_fuel_load_single_unique").on(fuelLoadId).where(fuelLoadId IS NOT NULL)`. Antes de la migración, preflight de duplicados: `select fuel_load_id, count(*) from dte_documents where fuel_load_id is not null group by 1 having count(*) > 1` — `scripts/preflight-dte-single-link.ts` no lo cubre y hay que extenderlo.

---

### [REC-04] La conciliación automática no aplica la guarda de fecha que sí exigen las dos rutas manuales — P2
**Dónde:** `lib/services/dte-portal/reconciliation.ts:316-336` y `:241-267`

**Qué pasa:** `validateDteForInvoiceTx` (`invoices.ts:335`) lanza «El DTE fue emitido antes de crear esta orden» y `selectDteCandidates` (`dte-candidates.ts:79`) filtra `fechaEmision >= createdOn`, con el comentario del incidente APRO del 2026-08-07 en la cabecera del archivo. `matchInvoiceToDteDocument` —que corre en **cada** alta de factura manual desde `createPurchaseOrderInvoice` (`invoices.ts:88`)— y `matchToPurchaseOrderInvoices` no comparan fecha ni monto: si folio+RUT calzan y hay exactamente un candidato, vinculan. La `discrepancy` que calculan se descarta (`invoices.ts:90` no usa el retorno).

**Cómo se rompe:** OC creada el 2026-08-10, proveedor 76.111.111-1. El 2026-07-03 ese proveedor emitió la factura 33 folio 4500 por 3.480.000 de otra compra, sin vincular. Compras tipea «4500» (el folio real era 4550) por 187.000. Único candidato con ese folio y RUT → se vincula. El DTE de julio, de 3,48 millones, queda colgado de una factura de 187.000 de una orden que no existía. La misma operación desde la UI habría sido rechazada.

**Impacto:** 3,3 millones de diferencia, sin aviso a quien registró la factura, consumiendo el DTE que la compra correcta necesitaba. Sólo visible en `/compras/dte?vinculo=discrepancia`.

**Arreglo:** Aplicar el mismo piso en ambas funciones (`fechaEmision >= localDateToISO(order.createdAt)`) y no vincular automáticamente cuando `|dteTotal - entityTotal| > tolerancia`: dejarlo como candidato para revisión manual.

---

### [REC-06] `reconciliationStatus` es estructuralmente `partial` y hace indistinguible una corrida con documentos perdidos — P2
**Dónde:** `lib/services/dte-portal/sync.ts:251-252`

**Qué pasa:**
```ts
const withIssues = reconciliation.unmatched + reconciliation.ambiguous + reconciliation.discrepancies
reconciliationStatus = withIssues > 0 ? "partial" : "success"
```
`unmatched` cuenta todo 33/34 del período sin vínculo (`reconciliation.ts:105`), lo que en producción incluye por definición los gastos sin OC. En `health.ts` la equivalencia es exacta: `reconciliationStatus === 'partial'` → `degraded` + `DTE_HEALTH_RUN_PARTIAL` (:189-190), y una ingesta realmente parcial (`totalRegistros > docs.length`) cae en :197-198 → **mismo estado, mismo código, mismo título y cuerpo** (`health-alerts.ts:37-41` sólo interpola `DTE_HEALTH_DEGRADED`). El fingerprint (`health-alerts.ts:30`) incluye `slot.id`, que es `${clock.date}T${hour}:${minute}`: cambia en cada slot.

**Cómo se rompe:** Martes, corrida 13:00 con `unmatched = 41` (gastos sin OC) → notificación «Sincronización DTE con trabajo pendiente» a todos los titulares de `admin:dte_sync`. Se repite 07:00/13:00/19:00 todos los días. El jueves el portal declara 578 y el parser lee 575 — tres facturas perdidas del libro — y la alerta es idéntica a la de los tres días anteriores.

**Impacto:** Tres notificaciones diarias permanentes que entrenan a ignorarlas. Como `purchases` nunca vuelve a `healthy`, la notificación de recuperación no se emite jamás.

**Arreglo:** `unmatched` es inventario de trabajo pendiente, no defecto: sacarlo de `withIssues` y dejarlo como contador informativo. `partial` sólo para `ambiguous > 0` o `discrepancies > 0`. Y usar códigos distintos (`DTE_HEALTH_INGEST_PARTIAL` vs `DTE_HEALTH_RECONCILIATION_PARTIAL`) en el cuerpo, para que el fingerprint los separe.

---

### [REC-07] Una carga de combustible con DTE vinculado se puede editar libremente y no se puede borrar — P2
*(consolida los dos hallazgos de edición y borrado)*

**Dónde:** `app/(app)/combustibles/actions-module/loads.ts:168-305` (update) y `:314-353` (delete)

**Qué pasa:** Vincular un DTE no toca `fuel_loads` (`reconciliation.ts:522` sólo actualiza `dteDocuments`), así que la carga sigue en `registered`. Las únicas guardas de `updateFuelLoadAction` son `status === 'reconciled'` (que es la conciliación de cuenta corriente) y `statementId`: `receiptNumber`, `fuelSupplierId` y `totalAmount` —los tres campos que definen la identidad del vínculo— son editables sin restricción. Grep de `fuelLoadId`: ningún archivo bajo `app/(app)/combustibles` lo lee, así que el operador no sabe que existe el vínculo. Del lado del borrado, la FK es `ON DELETE no action` (`db/migrations/0133_gigantic_hex.sql:58`) y `deleteFuelLoadAction` no desvincula antes de borrar, a diferencia de `deletePurchaseOrderInvoice`; el `dbErrMsg` local (`loads.ts:45-51`) devuelve `cause.message`, o sea el texto del motor.

**Cómo se rompe:** DTE 33/88123 de Copec por 450.000 vinculado a la carga L. El operador corrige el proveedor a «Petrobras» y el total a 460.000: se guarda sin objeción y `dte_documents.fuel_load_id` apunta a una carga de otro proveedor, con discrepancia reportada en cada corrida. Si en vez de editar intenta borrar la carga duplicada, el toast muestra literalmente `update or delete on table "fuel_loads" violates foreign key constraint "dte_documents_fuel_load_id_fuel_loads_id_fk"` y no hay ninguna pantalla para desvincular.

**Impacto:** El vínculo DTE↔carga —única evidencia de que ese documento corresponde a esa compra— queda falso por una edición normal; y la carga queda imborrable sin acceso a la base, con el esquema interno filtrado en la UI.

**Arreglo:** En `updateFuelLoadAction`, consultar `dteDocuments` por `fuelLoadId = id` y rechazar (o desvincular explícitamente en la misma tx, dejando auditoría) cuando cambien `receiptNumber`/`fuelSupplierId`/`totalAmount`. En `deleteFuelLoadAction`, meter el delete en una tx que antes haga `tx.update(dteDocuments).set({ fuelLoadId: null }).where(eq(dteDocuments.fuelLoadId, id))`, y reemplazar `dbErrMsg` por `safeActionMessage` de `lib/action-error.ts`. Mostrar el DTE vinculado en `/combustibles/[id]`.

---

### [CMP-05] El Libro de Compras Electrónico exporta Neto e IVA vacíos salvo para los DTE cuyo XML alguien abrió a mano — P2
**Dónde:** `lib/reports/export-module/dte-libro-compras.ts:28-29,54-56`

**Qué pasa:** La ingesta escribe nulos a propósito (`sync.ts:417-419`: `montoNeto: null, // La bandeja no trae neto separado; se llena al descargar el XML (bajo demanda)`) y el UPDATE del upsert (`sync.ts:394-402`) tampoco los rellena al re-sincronizar. El único escritor es el `db.update` de `downloadDteDocumentXml`, que sólo corre si alguien abre el XML de ese documento. El export vuelca las columnas crudas, sin derivar ni marcar la ausencia — teniendo `deriveTax` disponible en `factura-en-linea.ts:400`.

**Cómo se rompe:** Se sincronizan los 681 DTE del mes. Nadie abre el XML (el caso normal: sólo se abren los que se registran contra una OC). El «Libro de Compras Electrónico» del período sale con las columnas Neto e IVA en blanco en las 681 filas.

**Impacto:** Un reporte que se entrega como evidencia tributaria sale sin base imponible ni IVA para casi todas las filas.

**Arreglo:** Derivar en el export cuando falten, reusando `deriveTax`, **con columna u observación que distinga lo leído del XML de lo derivado** — `neto = total / 1.19` sólo vale para 33 afectos; para 34 exentas y facturas con IEC de combustible inventaría IVA. Alternativa mayor: bajar el XML durante la sincronización.

---

### [CMP-06] La conciliación DTE↔combustible no puede funcionar en el caso normal: una factura mensual cubre varias cargas y el conciliador la descarta por ambigua — P2
**Dónde:** `lib/services/dte-portal/reconciliation.ts:487-505`

**Qué pasa:** El importador documenta y acepta explícitamente varias cargas bajo un mismo documento (`lib/combustibles/import.ts:126-134`: «Una factura real puede traer varias líneas de detalle… antes esa factura legítima de 5 líneas reportaba '4 duplicados'») y el endpoint deduplica por `loadKey(supplierId, receiptNumber, vehicleId, loadDate, liters)`, es decir inserta N filas con el mismo `receiptNumber`. El modelo de vínculo es 1:1 (`dteDocuments.fuelLoadId`), así que la segunda carga con la misma clave `folio|RUT` entra en `ambiguousLoads` y la clave se borra del mapa.

**Cómo se rompe:** Planilla TAE de julio, factura 500123 de Copec con 40 líneas → 40 filas con `receiptNumber = "500123"`. Llega el DTE 33/500123. La clave se marca ambigua y se elimina: el DTE nunca se vincula, queda contado como `unmatched`, la corrida cierra `partial` y no existe acción manual equivalente a `attachDteAsInvoice` para combustible.

**Impacto:** La conciliación tributaria del gasto recurrente de mayor volumen queda estructuralmente sin evidencia vinculada, y alimenta el ruido permanente de REC-06.

**Arreglo:** Decisión de modelo: tabla de unión N:1 (un DTE cubre varias cargas) agrupando por `(receiptNumber, supplierRut)` y comparando `montoTotal` del DTE contra la **suma** del grupo. Mínimo lazy mientras tanto: distinguir en `summarizeDteReconciliation` la ambigüedad del lado interno de «sin vínculo», para que la corrida no acuse un problema que el diseño garantiza.

---

### [VTA-04] `upsertExternalRef` sólo protege uno de los dos índices únicos — P2
**Dónde:** `lib/services/billing/invoices.ts:431-433`

**Qué pasa:** `billing_external_refs` tiene dos índices únicos: `(provider, external_id)` y `(invoice_id, provider)`. El `onConflictDoNothing` nombra sólo el primero. Si el mismo documento interno vuelve con otro `externalId` del mismo proveedor, el INSERT no choca con el primero (id nuevo) pero sí con el segundo — un 23505 que nadie captura. El `externalId` no es inmutable: en compras alterna entre `fel:bandeja:${codEmp}:${nreguist}` y la clave natural según si `extractNreguist` logra decodificar el `post=` base64 de **esa** fila (`bandeja-entrada.ts:187`).

**Cómo se rompe:** Cambio de CodEmp (433 → 500), o una variación del HTML que haga fallar `extractNreguist` en filas ya importadas. `upsertProviderInvoice` encuentra la factura por identidad tributaria, llama a `upsertExternalRef` y el INSERT viola `billing_external_refs_invoice_provider_unique`. `sync.ts:213` lo captura por documento, la tx revierte, sube `errorsCount` y `mustRetryPage = true`: **el cursor de XML no avanza** y la corrida repite igual en cada ejecución. El único texto que ve el operador es «Folio 1234 (33): El proveedor no completó la sincronización [detalle técnico omitido]».

**Impacto:** Ventas atascadas en un bucle sin diagnóstico. (Nota: el ejemplo de cambiar el formato de `DTE_PORTAL_RUT_EMP` **no** dispara nada — `listIssuedInvoices` aplica `cleanRut` antes de construir la clave.)

**Arreglo:** Antes de insertar, buscar por `(invoiceId, provider)` además de por `(provider, externalId)`; si existe una del mismo proveedor con otro `externalId`, actualizar esa fila (el par invoice/provider es la identidad real) o lanzar `BillingExternalReferenceConflict` con su mensaje.

---

### [CRED-01] El re-cifrado del keyring no re-envuelve los secretos de Chipax — P2
**Dónde:** `lib/services/dte-portal/settings.ts:584-618`

**Qué pasa:** `rotateDteSettingsKeyring` selecciona sólo `like(systemSettings.key, "dte.%")` y recorre `SENSITIVE_FIELDS` de `DTE_SETTING_KEYS`. Los secretos de Chipax viven en `billing.chipax.app_id`/`secret_key` cifrados **con el mismo keyring** (`encryptDteSetting` importado en `chipax-settings.ts:249`) y nadie los re-envuelve. El sobre lleva el `kid` (`settings-crypto.ts:136-143`) y `decryptDteSetting` lanza `DTE_SETTINGS_KEY_UNAVAILABLE` si ese kid no está. El runbook (`docs/facturacion/DTE_SYNC_OPERACION_SEGURA.md:75`) manda retirar la clave anterior después del re-cifrado, y el diálogo de confirmación lo repite.

**Cómo se rompe:** Keyring k1. Se rota la secret_key en Chipax y se guarda desde la UI (queda `enc:v1:k1:…`), dejando en el `.env` la clave revocada. Semanas después se agrega k2, se activa, se pulsa «Re-cifrar con clave activa» (rewrapped=5, sólo `dte.*`) y se retira k1. Desde ese reinicio `openSecret` (`chipax-settings.ts:123-131`) traga el fallo, devuelve null y `readChipaxConfig` cae a `env.secretKey` **revocado**: el cron de las 09:00 recibe 401 todos los días.

**Impacto:** El sobre de Chipax queda ilegible para siempre (la secret_key se puede regenerar; el sobre no) y la plataforma usa en silencio una credencial vieja. `readChipaxAdminStatus` sólo reporta `source: "environment"`, así que la alerta que sí se emite apunta a la causa equivocada.

**Arreglo:** Incluir `Object.values(CHIPAX_SETTING_KEYS)` en la selección de `rotateDteSettingsKeyring` (o cambiar el filtro por `like 'dte.%' OR key IN (…chipax)`), con la misma verificación `decrypt(encrypt(x)) === x` antes de confirmar. Mientras eso no exista, `openSecret` debe distinguir `DTE_SETTINGS_KEY_UNAVAILABLE` y no caer al entorno (ver CRED-03).

---

### [CRED-02] Sin keyring, guardar la configuración DTE persiste la contraseña del portal en texto plano — P2
**Dónde:** `lib/services/dte-portal/settings.ts:336-343`

**Qué pasa:**
```ts
const encrypted = keyring.activeKeyId ? encryptDteSetting(value, key, keyring) : value
writes.push({ key, value: encrypted })
```
La única guardia (`encryptionMode === "encrypted_only" && !keyring.activeKeyId`, línea 322) actúa sólo después del corte durable. `parseDteSettingsKeyring` devuelve `{mode:"compat", activeKeyId:null}` sin lanzar con `DTE_SETTINGS_KEYRING` vacío, que es el default real (`.env.example:160`, `docker-compose.yml:83/85` con `${DTE_SETTINGS_KEYRING:-}` / `${DTE_SETTINGS_MODE:-compat}`). La ruta gemela de Chipax hace lo contrario: `saveChipaxSettings` lanza `CHIPAX_KEYRING_REQUIRED` antes de escribir nada, y su diálogo deshabilita los inputs.

**Cómo se rompe:** Servidor con el compose por defecto. Un usuario con `admin:dte_sync` guarda la clave `Portal.2026`: la acción responde «Credenciales del portal DTE guardadas» y queda la fila `('dte.clave','Portal.2026')` legible en la BD, replicada en cada `pg_dump` del `backup-scheduler` y, con `GDRIVE_BACKUPS_DEST` configurado, fuera del servidor.

**Impacto:** Contraseña del portal tributario en claro en la BD y en los respaldos. `DtePortalAdminStatus` no expone nada tipo `canStoreSecrets` y `credentials-form.tsx` no deshabilita ni advierte: antes del primer guardado el estado es `not_configured`, o sea cero aviso en el momento de decidir.

**Arreglo:** `compat` debe servir para **leer** filas legacy, no para escribir nuevas: en `applySensitive`, si `!keyring.activeKeyId`, lanzar `DTE_SETTINGS_KEYRING_REQUIRED`. Agregar `canStoreSecrets: Boolean(keyring.activeKeyId)` al DTO de Admin y deshabilitar los inputs con aviso, igual que `chipax-settings-dialog.tsx`.

---

### [PAR-05] `rutEmisor` se persiste con la ortografía cruda del portal: es parte de la clave única y del nombre del XML — P2
**Dónde:** `lib/services/dte-portal/bandeja-entrada.ts:157` · `lib/services/dte-portal/sync.ts:379,414` · `app/(app)/compras/actions/dte-download-xml.ts:70`

**Qué pasa:** `parseBandejaRow` toma `(cellTexts[10] ?? "").trim()` crudo y `upsertDteDocument` lo usa tal cual en el `findFirst` y en el `insert`, contra `uniqueIndex(tipo_dte, folio, rut_emisor, cod_emp)`. Todos los demás consumidores canonizan: `reconciliation.ts` (6 sitios con `cleanRut`), `purchase-document-pdf.ts:141`, y `factura-en-linea.ts:333` con el comentario explícito «El HTML de la bandeja trae el RUT con puntos; sin normalizar, la misma factura vía otro proveedor generaba una identidad distinta». Encima `dte-download-xml.ts:70` reconstruye `PRV_${doc.rutEmisor}_${doc.tipoDte}_${doc.folio}.xml` con el valor crudo.

**Cómo se rompe:** Un cambio de plantilla del portal hace que el proveedor aparezca como `96.542.490-3` en vez de `96542490-3`. El `findFirst` no encuentra la fila y la clave única no choca: la misma Factura 33/3017654 queda insertada dos veces. Después `matchToPurchaseOrderInvoices` construye la misma `folioRutKey` para ambas (porque sí normaliza) y las descarta como ambiguas: ninguna concilia. Y la URL `PRV_96.542.490-3_33_3017654.xml` no existe, así que el XML no se puede bajar nunca.

**Impacto:** Duplicación de evidencia tributaria, conciliación bloqueada por ambigüedad autoinfligida y XML irrecuperable (sin neto/IVA) para toda ortografía con puntos. Hoy la captura real trae el RUT sin puntos, así que no hay filas dañadas; lo confirmado es la divergencia: la clave de persistencia y la URL del XML dependen de la ortografía del portal mientras todo lo demás la canoniza.

**Arreglo:** `const rutEmisor = cleanRut((cellTexts[10] ?? "").trim())` en `parseBandejaRow`, y el mismo valor canónico en `dte-download-xml.ts:70`. Backfill sólo si aparecen filas con puntos.

---

### [ORQ-01] El control de completitud se auto-certifica cuando el portal deja de declarar el total — P2
*(consolida los dos hallazgos del fallback `?? rows.length`)*

**Dónde:** `lib/services/dte-portal/bandeja-entrada.ts:95-100,231` · `lib/services/dte-portal/sync.ts:199-202`

**Qué pasa:**
```ts
const totalRegistros = declaredTotal ?? rows.length
if (totalRegistros !== rows.length) { logger.warn(...) }
// sync.ts:199
if (totalRegistros > docs.length) { finalStatus = "partial"; errorMsg = `El portal declara ...` }
```
`extractBandejaTotal` usa `/tbxTotalRegistros["'][^>]*value=["'](\d+)["']/i`, que exige comilla inmediata tras el nombre y `value=` **después** del nombre. Cuando no matchea, `totalRegistros` se define como `rows.length` y ambas comparaciones quedan comparando un número consigo mismo. `parseBandejaResult` sólo lanza `PARSE_FAILED` si además `rows.length === 0`. `DteBandejaResult` no propaga la nulidad a `sync.ts`, y `CronRunEvidence` (`health.ts:21-29`) no lleva `rowsSeen`, así que el evaluador de salud tampoco lo ve. Los tests cubren total>filas, total==filas y sin-total-con-0-filas: **no** sin-total-con-filas, que es el hueco.

**Cómo se rompe:** El portal renderiza 2026-09 con 578 documentos pero emite `<input name=tbxTotalRegistros value=578>` (sin comillas, o con `value` antes de `name`) y el marcador de fila sólo aparece en 300. `extractBandejaTotal` → null, `totalRegistros = 300 = docs.length` → `success`, `rowsSeen = 300`. Health responde OK y faltan 278 DTE de compra del mes.

**Impacto:** Libro de compras incompleto certificado como correcto: IVA crédito fiscal no registrado y facturas de OC sin su DTE. Misma clase de pérdida que motivó la ventana móvil, esta vez sin alerta. El caso hermano —`tbxTotalRegistros=0` con la plantilla normal por un `codEmp` mal configurado— cierra `success` con 0 filas por la misma razón.

**Arreglo:** Propagar `declaredTotal: number | null` en `DteBandejaResult` y que `sync.ts` trate `null` como corrida `partial` con motivo «no se pudo verificar la completitud». No degradar el total a `rows.length`. Ojo: **no** convertirlo en `PARSE_FAILED` a secas — el caso `total=0` con período legítimamente vacío es deliberado y está cubierto por prueba (`bandeja-entrada.test.ts`, «does not throw for a genuinely empty period»).

---

### [API-02] La lista de Documentos DTE corta en 300 filas y filtra después del corte — P2
**Dónde:** `app/(app)/compras/dte/page.tsx:53`

**Qué pasa:** El `limit: 300` se aplica en SQL sobre el período completo ordenado por `fechaEmision desc`, y los filtros de negocio se evalúan en memoria sobre ese recorte:
```ts
const filtered = rows.filter((r) => {
  if (vinculo === "sin_oc") return r.vinculoTipo === "ninguno"
  if (vinculo === "discrepancia") return r.discrepancy !== null && r.discrepancy > DISCREPANCY_TOLERANCE_CLP
  return true
})
```
No hay paginación (el comentario lo declara: «Sin paginación a propósito») ni indicador de truncamiento; el `EmptyState` sólo aparece con 0 filas. El propio repo documenta 681 documentos en un mes real (`config.ts:32-34`).

**Cómo se rompe:** Período con 681 DTE. Un usuario entra a `/compras/dte?vinculo=sin_oc`: se traen los 300 más recientes (del 31 al ~14) y los 381 del 1 al 13 no se consultan nunca. Si los sin vínculo están en la primera quincena, la pantalla los declara inexistentes.

**Impacto:** Revisión incompleta de evidencia tributaria; el mismo mes por Excel (límite 10.000) y en pantalla dan cifras distintas.

**Arreglo:** Llevar el filtro `vinculo` al WHERE (`isNull(purchaseOrderInvoiceId) and isNull(fuelLoadId)`) y pedir `limit: 301` para detectar el recorte y avisar «se muestran los primeros 300 de N».

---

### [API-03] El export de cobranza por `/api/reportes/export` no se audita y no exige `billing:view` — P2
**Dónde:** `app/api/reportes/export/route.ts:33`

**Qué pasa:** `facturacion_cobranza: ["billing:export"]` con `canAny` (OR sobre la lista) = un solo permiso exigido, y el archivo no importa `recordAudit` en ninguna parte. La ruta gemela `app/api/facturacion/facturas/export/route.ts:22` exige `can(session,"billing:view") && can(session,"billing:export")` y registra `recordAudit({action:"export", entityType:"billing_invoices"})` (líneas 39-46). El manifiesto declara lo contrario: `modules/billing/manifest.ts:24` — «`billing:export` — exportar (queda auditado)».

**Cómo se rompe:** `GET /api/reportes/export?tipo=facturacion_cobranza` descarga el Excel completo de cuentas por cobrar (razón social, RUT, neto/IVA/total, saldo, tramo de antigüedad, ranking de clientes y faenas) y no queda una fila en `audit_log`. La mitad RBAC es hoy teórica (ningún rol sembrado tiene `export` sin `view`); **la ausencia de auditoría aplica siempre y a todos**.

**Impacto:** Extracción no trazable de la cartera. Ante una fuga no hay forma de saber quién la descargó ni con qué filtros.

**Arreglo:** Exigir ambos permisos con `can` (no `canAny`) y agregar el mismo bloque de `recordAudit` que ya existe en la ruta gemela, con `entityType: "billing_cobranza"` y `newState: { filters, rows: report.rows.length }`.

---

### [API-04] Todos los lectores de DTE se llavean contra el `codEmp` vivo: al borrar la configuración el Libro de Compras exporta vacío — P2
**Dónde:** `lib/reports/export-module/dte-libro-compras.ts:19,35` (idéntico en `dte-conciliacion.ts:16/30`, `dte-facturas-sin-oc.ts:16/30`, `compras/dte/page.tsx:38`, `computeHealthStats`, `countPendingFuelCreditNotes`)

**Qué pasa:** El `codEmp` se toma de la configuración vigente, no de los documentos guardados, y `readDtePortalConfig` devuelve cadena vacía cuando no hay valor guardado y el fallback al `.env` está prohibido (`config.ts:94-95`: `storedValue !== undefined ? storedValue : allowEnvironmentFallback ? environmentValue : ""`). Nada valida que no esté vacío antes de consultar; `eq(dteDocuments.codEmp, "")` no calza con ninguna fila. `buildDtePortalClientConfig` sí valida, pero sólo lo usan sync y descargas.

**Cómo se rompe:** 5.000 documentos con `codEmp = "433"`. Un administrador usa «Borrar configuración» para rotar credenciales; en modo `encrypted_only` el fallback queda prohibido y `credentials.codEmp` pasa a `""`. Contabilidad descarga el Libro de Compras del mes: Excel con cabecera, cero filas, HTTP 200, sin advertencia. Mismo efecto —en cualquier modo— si el `codEmp` se corrige a otro valor: todo lo sincronizado antes queda huérfano.

**Impacto:** Un libro de compras vacío presentado como completo. Y el dashboard muestra 0 NC de combustible pendientes y 0 DTE sin OC por la misma causa: todo se lee como «nada pendiente».

**Arreglo:** Un `requireDteCodEmp()` compartido que lance si es cadena vacía, usado en los tres reportes y en `/compras/dte`. Fallar cerrado, no devolver vacío.

---

### P3

---

### [OPS-01] `seed-demo-gaps` hace `TRUNCATE CASCADE` de facturación sin ningún guardia de entorno — P3
**Dónde:** `scripts/seed-demo-gaps.ts:54-65`

**Qué pasa:** El script trunca la lista completa sin comprobar nada:
```ts
const TABLAS = [ "clients", "billing_invoices", "billing_sync_runs", … ]
await db.execute(sql.raw(`TRUNCATE ${TABLAS.join(", ")} CASCADE`))
```
Usa el `DATABASE_URL` del entorno (`loadEnvConfig(process.cwd())`), sin mirar `NODE_ENV`, sin confirmación interactiva y sin `--force`. `seed-demo.ts:15` al menos lleva la advertencia «NO tocar en producción»; éste ni eso. El `CASCADE` se propaga a las nueve tablas con FK a `billing_invoices`.

**Cómo se rompe:** Alguien corre `npx tsx scripts/seed-demo-gaps.ts` para poblar el tablero de demo con un `.env.local` que apunta a producción, o exporta el `DATABASE_URL` de prod para una consulta previa y olvida limpiarlo. En un segundo desaparecen todas las facturas de venta sincronizadas, los pagos confirmados, los vínculos factura↔contrato, las gestiones de cobranza y el historial de corridas — y los movimientos de `billing_bank_transactions` sobreviven huérfanos, así que la conciliación vuelve a proponerlos como disponibles.

**Impacto:** Pérdida irrecuperable —salvo restore— de toda la cuenta por cobrar y su evidencia de auditoría, por un comando de una línea sin confirmación. Con BKP-01 en el estado actual, el restore además no devuelve las integraciones a funcionar.

**Arreglo:** Guardia al inicio: abortar si `NODE_ENV === "production"` o si `DATABASE_URL` no contiene un marcador de base desechable, y exigir `--yes` explícito. El mismo guardia sirve para `seed-demo.ts`.

---

### [OPS-02] Un estado de proveedor «Con problema» nunca vence: un fallo de hace meses se muestra como diagnóstico vigente — P3
**Dónde:** `lib/services/billing/health.ts:181-189`

**Qué pasa:** La guarda de vencimiento exige que el estado guardado sea bueno:
```ts
if (input.stored.ok && (!Number.isFinite(checkedAtMs) || nowMs - checkedAtMs > BILLING_HEALTH_TTL_MS)) {
  return { kind: "stale", label: "Comprobación vencida", … }
}
```
Un `stored.ok === false` salta el bloque y cae directo a `failing`, con el `detail` de aquel día. La asimetría es al revés de lo conveniente: un «Operativo» viejo se degrada honestamente a «Comprobación vencida», y un «Con problema» viejo se congela como si fuera actual. El único escritor es `checkProviderHealthAction`, bajo demanda; no hay comprobación programada que lo refresque.

**Cómo se rompe:** El 1 de junio Chipax está caído, alguien pulsa «Probar conexión» y se persiste `{ok:false}`. Se arregla ese mismo día y el cron pasa a `success` a diario. El 19 de agosto `/facturacion/sincronizacion` sigue mostrando «Con problema» con el detalle de junio y sin marca de antigüedad, mientras el historial de corridas tres líneas más abajo dice que todo funciona.

**Impacto:** El semáforo que `SINCRONIZACION.md` vende como indicador del módulo enseña a ignorar el rojo — y un fallo real que empezó ayer queda indistinguible del fósil.

**Arreglo:** Aplicar el TTL a los dos signos: si se superó `BILLING_HEALTH_TTL_MS`, devolver `stale` sea `ok` true o false, conservando el detalle previo en el texto. O como mínimo, mostrar siempre la antigüedad junto a «Con problema».

---

### [PAR-01] `parseMonto` nunca falla: cualquier separador o entidad HTML inesperada produce un monto distinto en silencio — P3
**Dónde:** `lib/services/dte-portal/parser.ts:209-216`

**Qué pasa:**
```ts
const cleaned = text.replace(/[^0-9,\-]/g, "").replace(/\./g, "").replace(",", ".")
const n = parseFloat(cleaned); return isNaN(n) ? null : n
```
El filtro borra todo lo que no sea dígito/coma/guión —incluidos los dígitos de contexto que sobreviven de una entidad numérica— y `.replace(",", ".")` reemplaza **sólo la primera** coma. `parseRow`/`parseBandejaRow` quitan etiquetas pero nunca decodifican entidades (`decodeHtmlEntities()` existe y sólo se aplica a URLs). Ejecutado sobre la implementación real: `"1,234,567"→1.234`, `"49,742"→49.742`, `"&#160;59500"→16059500`, `"(15.000)"→15000` (signo perdido). No hay validación de plausibilidad ni check constraint en `monto_total`.

**Cómo se rompe:** No es un defecto activo — el HTML actual trae el total como entero desnudo (`49742`) y el parser es correcto para todos los formatos chilenos observados. Se activa si el portal pasa a `number_format()` por defecto o emite `&#160;` en vez de `&nbsp;`. Señal parcial existente: para los DTE que cruzan contra OC/combustible la conciliación reporta `discrepancies`; el punto ciego son los DTE sin vínculo.

**Impacto:** Monto tributario corrupto sin ninguna señal, alimentando `AMOUNT_TOLERANCE_CLP` de `dte-candidates.ts`, el prefill de facturas y los reportes.

**Arreglo:** Parser estricto: decodificar entidades antes de limpiar, aceptar sólo `^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$` y devolver null en cualquier otro caso (la fila se descarta y `totalRegistros > docs.length` marca `partial`, que es el comportamiento honesto). `.replace(/,/g, ".")` sólo tras validar una sola coma.

---

### [PAR-02] La respuesta HTML del portal se acumula completa en memoria sin límite superior — P3
**Dónde:** `lib/services/dte-portal/client.ts:251`

**Qué pasa:** `downloadBinary` sí tiene tope (`contentLengthExceedsLimit` + corte en streaming), pero el camino de consulta —`client.get`/`post` → `fetchWithTimeout`— hace `response.arrayBuffer()` sin cap y sin mirar `content-length`, con `requestTimeoutMs = 120_000`. Después convierte a `latin1`, duplicando memoria, y pasa el string a regex globales. undici no impone límite propio.

**Cómo se rompe:** El portal (o un intermediario) responde 200 con un cuerpo que crece durante los 120 s del timeout. El tope efectivo es 120 s × ancho de banda, ×2-3 por las copias. Sin evidencia de que el portal haga esto; es asimetría con el camino binario.

**Impacto:** Riesgo de OOM del proceso Next.js —toda la plataforma, no sólo la sincronización— por una respuesta del portal.

**Arreglo:** En `fetchWithTimeout`, `readBinaryResponse(response, MAX_DTE_HTML_BYTES)` (32 MB; la bandeja real de 681 documentos ocupa cientos de KB) con chequeo de `content-length`, lanzando `INVALID_RESPONSE`. Una línea, reusando lo que ya existe.

---

### [PAR-06] `splitTopLevelTdCells` cuenta los `<td>` dentro de comentarios HTML: el mapa de columnas depende de un comentario muerto — P3
**Dónde:** `lib/services/dte-portal/parser.ts:326-352`

**Qué pasa:** `const tagRe = /<(\/?)(td|table)\b[^>]*>/gi` no conoce `<!-- -->`. En la Bandeja la columna 4 es exactamente eso: `<!--<td align='center'><span style='color:red'>PENDIENTE</span></td>-->`, markup que el navegador nunca renderiza. El parser lo cuenta como celda real, y por eso los índices fijos de `parseBandejaRow` (7=fecha, 9=folio, 10=RUT, 13=total) cuadran. `parseBandejaRow` tampoco exige un mínimo de celdas como `parseDteTable` (`cells.length < 9`).

**Cómo se rompe:** El portal elimina el comentario del template: todas las celdas se corren, `cellTexts[7]` deja de ser la fecha, `parseFechaPortal` devuelve null y las 681 filas se descartan con `DTE_BANDEJA_DATE_INVALID`. La corrida queda `partial` («declara 681 y se pudieron leer 0») — no es silencioso, pero el mes queda vacío. (El dato de «537 de 681 filas» de la exploración cuenta ocurrencias del texto `PENDIENTE` dentro del comentario, no filas con y sin comentario: no es evidencia de variación fila a fila.)

**Impacto:** Un cambio cosmético del portal borra el mes completo de compras. La dependencia es invisible: el mapa documentado describe el comentario como una columna.

**Arreglo:** `html.replace(/<!--[\s\S]*?-->/g, "")` dentro de `splitTopLevelTdCells` y reindexar `parseBandejaRow` a la numeración real, o anclar por `<th>`. Más un guard de longitud mínima como el de `parseDteTable`.

---

### [PAR-07] La URL cruda raspada del HTML se persiste verbatim en `billing_external_refs.document_url` — P3
**Dónde:** `lib/services/dte-portal/parser.ts:173-176` → `lib/services/billing/providers/factura-en-linea.ts:315` → `lib/services/billing/invoices.ts:421`

**Qué pasa:** `extractPdfPostUrl` devuelve el primer `href` que contenga `pdf_dte.php`, decodificado y sin más inspección, y ese string se guarda tal cual en una columna `text` sin cifrar. El cliente ya tiene `sanitizeUrl` con `CREDENTIAL_KEYS = ["rut_usr","rut_emp","clave"]`, pero sólo lo usa en `getStatus()`. El camino de compras ya resolvió esto (`normalizeLegacyPurchasePdfUrl` reconstruye `dtepdfX.php?post=` y descarta parámetros ajenos); el de ventas no.

**Cómo se rompe:** **Hoy no filtra nada**: los `href` de `pdf_dte.php` traen sólo `post=<base64>` (y a veces `Ced=1`); la cadena con `clave=` vive en un `onClick="window.location='paneldte.php?...'"` que el regex (que exige `href=`) no captura. Se activaría si el portal agregara `&clave=` a los enlaces, con la misma plantilla PHP que ya lo hace en el `onClick`.

**Impacto:** Preventivo. Si ocurriera: credencial del portal tributario en texto plano en la BD y en todos los backups, evadiendo el cuidado que el resto del módulo pone en no filtrarla.

**Arreglo:** Quedarse sólo con el parámetro `post` en `extractPdfPostUrl`/`extractBandejaPdfUrl`, como ya hace `purchase-document-pdf.ts:165-181`.

---

### [PAR-08] `parseFechaPortal` no valida el calendario: acepta mes 13 o día 45 — P3
**Dónde:** `lib/services/dte-portal/parser.ts:223`

**Qué pasa:** El regex `^(\d{4})-(\d{1,2})-(\d{1,2})$` sólo comprueba forma. Verificado ejecutando la función: `parseFechaPortal("2026-13-45")` devuelve `"2026-13-45"`. Ese valor va a `dteDocuments.fechaEmision`, que es `text().notNull()` sin check constraint (`db/schema/dte.ts:105`). Contrasta con `assertSyncablePeriodo`, que sí valida `(0[1-9]|1[0-2])` para el período.

**Cómo se rompe:** Fila con fecha corrupta por columna desalineada o dato mal cargado por el proveedor: no se descarta, se inserta. En la UI `formatDate` produce «Invalid Date» y en el Excel del Libro de Compras sale una fecha inválida. (El impacto sobre el PDF está sobredimensionado: `resolvePdfUrl` sólo compara `row.fecha === doc.fechaEmision` en la rama legacy sin `portalRecordId`.)

**Impacto:** Fecha inválida en un documento que se exporta como evidencia tributaria.

**Arreglo:** Tras el match, `const d = new Date(Date.UTC(y, m-1, dd))` y comprobar que los componentes vuelven iguales; si no, null → la fila cae por `DTE_BANDEJA_DATE_INVALID` y la corrida se reporta `partial`. Tres líneas.

---

### [ORQ-02] El motivo de una corrida `partial`/`failed` no se puede leer en ninguna pantalla, pero el mensaje y la alerta mandan a mirarlo ahí — P3
**Dónde:** `app/(app)/admin/dte/page.tsx:38-50`

**Qué pasa:** La página enumera columnas y omite `error` con comentario explícito («old portal payloads stay in DB»), y `dte-sync-list.tsx` sólo renderiza chips, contadores y `reconciliationError`. Recorridos todos los lectores de `dteSyncRuns`: sólo esta página y `app/api/cron/dte-sync-health/route.ts:63-69`, que tampoco lo selecciona. Los mensajes de `actions.ts:57`/`:69` («revise el historial de corridas») y el `entityHref: "/admin/dte"` de `health-alerts.ts:74,88` apuntan justo ahí. El texto ya viene redactado por `classifyDteFailure`.

**Cómo se rompe:** Corrida `partial` porque el portal declaró 578 y se leyeron 575. Llega la notificación, el operador abre /admin/dte, ve el chip «Parcial» y «Vistos 575», y asume que «parcial» es la conciliación (única columna con texto).

**Impacto:** La evidencia de que faltan DTE existe en la base y es inalcanzable para quien debe actuar; el ciclo alerta→diagnóstico está roto.

**Arreglo:** Seleccionar `error` y mostrarlo bajo el chip de estado, igual que `reconciliationError`. Conservar la redacción: condicionar a `startedAt >= <fecha de la release que redacta>` o filtrar por prefijo de código, no simplemente añadir la columna.

---

### [ORQ-03] Las filas descartadas por el parser se registran sin `correlationId`, sin período y sin identidad — P3
**Dónde:** `lib/services/dte-portal/bandeja-entrada.ts:141,148,155,162,169`

**Qué pasa:** Las cinco llamadas son `logger.warn("[dte-bandeja] fila descartada", { code })`. `lib/logger.ts:79-92` extrae el correlationId sólo si `args[0]` es un objeto que lo contiene; ninguna lo lleva, ni el período, ni el codEmp, ni folio/tipo. `fetchBandejaEntrada(client, filter)` ni siquiera recibe el correlationId (`sync.ts:184` pasa sólo mes/año/codEmp/filtros). Contrasta con `sync.ts:214,232,266`, que sí correlacionan.

**Cómo se rompe:** El cron de las 13:00 sincroniza 2026-08 y 2026-07 en la misma invocación. Tres filas de 2026-08 traen fecha en formato nuevo → tres warns idénticos → corrida `partial` «faltan 3». No hay forma de saber de qué período son ni qué folios faltan.

**Impacto:** Documentos perdidos en la ingesta que no se pueden identificar ni recuperar dirigidamente; obliga a cotejo manual completo. (El `code` sí distingue el motivo — DATE/FOLIO/AMOUNT/TYPE/RUT — lo que falta es período, correlación y folio/tipo.)

**Arreglo:** Pasar correlationId y período a `fetchBandejaEntrada`/`parseBandejaResult` y emitir `logger.warn({ correlationId }, "[dte-bandeja] fila descartada", { code, periodo, tipo: cellTexts[8], folio: cellTexts[9] })`. Folio y tipo no son PII.

---

### [ORQ-04] El barrido de corridas colgadas es sólo por tiempo y sin fencing — P3
**Dónde:** `lib/services/dte-portal/sync.ts:307-318` y `:272-282`

**Qué pasa:** El único criterio de «corrida muerta» es `startedAt` más viejo que 1 h; no hay heartbeat ni token de fencing, el barrido alcanza todas las `running` del codEmp sin filtrar período, y el UPDATE de cierre es por id **sin condición de estado**. `markStaleRunsAsFailed` corre antes de `claimDteSyncStart` (:101 vs :146), así que una corrida nunca se autoinvalida, pero al marcar `failed` libera el índice único parcial y una segunda corrida entra legítimamente.

**Cómo se rompe:** Una corrida viva que supere la hora es marcada `failed`; la segunda arranca y ambas hacen select-then-insert sobre los mismos documentos; la que pierde choca con `dte_documents_unique_key`, suma `failures` y cierra `partial` sin que faltara nada. Al terminar, la primera hace su UPDATE final y su fila vuelve a `success`, borrando el veredicto del barrido. Con `requestTimeoutMs = 120_000` y ~600 upserts, superar 1 h no ocurre en operación normal.

**Impacto:** Fallos falsos contabilizados y estado de corrida no confiable (una fila pasa de `failed` a `success` sin que nada la reintentara), más dos sesiones simultáneas contra el portal.

**Arreglo:** Fencing en el cierre: `where(and(eq(id, runId), eq(status, "running")))` y, si `rowCount === 0`, registrar que la corrida fue expropiada en vez de resucitarla. Opcional: `heartbeatAt` refrescado en el bucle de upsert, para que el umbral mida inactividad y no duración.

---

### [ORQ-05] En el contrato del cron cualquier `skipped` tapa un período `failed` — P3
**Dónde:** `lib/services/dte-portal/cron-contract.ts:24-29`

**Qué pasa:** La rama de conflicto se evalúa **antes** que la de fallo y dispara con cualquier `"skipped"` en `statuses`, además del flag `conflict`. Un lote mixto se reporta como benigno.

**Cómo se rompe:** Un administrador pulsa «Sincronizar ahora» a las 12:59. El cron de las 13:00 encuentra 2026-08 con corrida activa → `skipped/active_run`; 2026-07 falla con `DTE_AUTH_FAILED`. `statuses = ["skipped","failed"]` → `409 DTE_CRON_ACTIVE_RUN`, health `waiting`, `runnerExitCode 2`. Nadie ve que la autenticación contra el portal está rota.

**Impacto:** El canal de salida del cron rebaja un fallo real a «esperando». Amortiguado porque el evaluador de salud sí lee `dte_sync_runs` y alerta crítico en su ventana: ceguera temporal, no pérdida.

**Arreglo:** Evaluar `failed` (y `partial`) antes que `conflict`, o dejar de derivar conflicto de `statuses` y confiar sólo en el flag que la ruta ya calcula. **La guardia `!invalidBarrier` de `route.ts:96` no es código muerto**: la ruta mapea `invalid_barrier` a `"failed"` en `statuses` (`route.ts:101-103`), y como la barrera es un ajuste global idéntico para ambos períodos, el caso resuelve 503/critical correctamente. El defecto es sólo el orden de las ramas.

---

### [ORQ-06] `POST /api/dte-portal/sync` valida el período con una regex más débil que el servicio y devuelve 500 genérico — P3
**Dónde:** `app/api/dte-portal/sync/route.ts:36`

**Qué pasa:** La ruta usa `/^\d{4}-\d{2}$/`; el servicio (`sync.ts:450-459`) valida rango, piso `DTE_HISTORY_FLOOR = "2024-01"` y no-futuro, pero lanzando un `Error` genérico que `classifyDteFailure` no reconoce y cae en `DTE_UNEXPECTED` → el catch de `route.ts:74-77` devuelve 500.

**Cómo se rompe:** `{"periodo":"2026-13"}` → `500 {"code":"DTE_UNEXPECTED","error":"La operación DTE falló de forma inesperada."}`. Igual con `2023-05` (bajo el piso) o `2027-01` (futuro). El assert es previo a `markStaleRunsAsFailed` y a `claimDteSyncStart`, así que no se crea corrida ni se toca el portal.

**Impacto:** Código HTTP de clase equivocada y mensaje inútil; el llamante no distingue su error de una caída real. Mismo agujero en `forceDteSyncPeriodAction`, que no valida el período en absoluto.

**Arreglo:** Envolver `assertSyncablePeriodo(body.periodo)` en un try que devuelva 400 con el mensaje del assert, en ambos caminos.

---

### [REC-05] La guarda de ambigüedad 33/34 sólo mira los DTE del período sincronizado — P3
**Dónde:** `lib/services/dte-portal/reconciliation.ts:225-233` (y el mismo patrón en `:463-468`)

**Qué pasa:** El comentario declara la regla («un 33 y un 34 con el mismo folio/RUT son dos candidatos para una sola factura interna y nunca se debe elegir uno por orden de llegada»), pero `unmatchedDocs` viene acotado por `eq(periodo)` y `eq(codEmp)` (:151-162), así que el mapa sólo detecta colisiones dentro del mismo mes. `matchInvoiceToDteDocument` (:316) sí consulta sin filtro de período y aborta con `matching.length !== 1`: la asimetría es el hueco. `rollingSyncPeriods` no lo cierra — cada llamada evalúa su período aislado.

**Cómo se rompe:** Proveedor mixto emite la Factura Exenta 34 folio 500 por 1.200.000 el 2026-07-28 y la Factura 33 folio 500 por 8.900.000 el 2026-08-04. Si el 33 llega en el mes que se sincroniza primero, se vincula a la factura de 1.200.000 sin marcar ambigüedad; en la otra corrida el segundo choca con `occupied` y queda fuera. Gana el que llegó primero, exactamente lo que el comentario prohíbe.

**Impacto:** Documento tributario equivocado del mismo proveedor adjunto a la factura de OC, con diferencia de millones, marcado como «conciliado». Probabilidad baja: el `uniqueIndex(tipoDte, folio, rutEmisor, codEmp)` deja como única colisión cruzada un 33 y un 34 del mismo emisor con folio idéntico en meses distintos, y además hace falta una factura interna con ese folio.

**Arreglo:** Construir el conjunto ambiguo consultando `(folio normalizado, RUT)` sobre toda la tabla sin vincular, no sólo el período — igual que `matchInvoiceToDteDocument`.

---

### [REC-08] `computeHealthStats` se ejecuta en cada render del Dashboard y su resultado no se muestra en ninguna parte — P3
*(consolida el hallazgo equivalente de la dimensión API)*

**Dónde:** `app/(app)/dashboard/sections/finance-section.tsx:68,81,118`

**Qué pasa:** `dteHealth` aparece exactamente en tres lugares: la desestructuración del `Promise.all`, la llamada, y la condición de la nota. Ningún `kpiGroups.push` ni gráfico lee `dteHealth.reconciliation`, `.creditNotes` ni `.estadoSii`. `computeHealthStats` (`reconciliation.ts:555-568`) hace un `findMany` de **todos** los `dte_documents` del período (~681 filas) más `countDiscrepancies`, que dispara dos consultas adicionales.

**Cómo se rompe:** Un usuario abre `/dashboard?vista=finanzas&faena=ws-1`. Tres consultas se ejecutan y se descartan, y bajo el título aparece «Las cifras de DTE son por empresa y período tributario, no por faena» sobre una sección donde no hay ninguna cifra de DTE. El lector concluye que alguno de los ocho tiles ignora el filtro, cuando todos lo respetan.

**Impacto:** Consulta cara en el camino crítico de la pantalla de aterrizaje de gerencia, y una nota que desacredita cifras correctas. Nota lateral: si las cifras se pensaban mostrar, `creditNotes.applied` sería siempre 0 — ninguna ruta puede vincular un 61.

**Arreglo:** Renderizar un tile con `dteHealth.reconciliation.unmatched` enlazando a `/compras/dte?vinculo=sin_oc`, o borrar la llamada, la nota y `dteCodEmp` si queda sin uso.

---

### [CRED-03] `openSecret` de Chipax falla abierto hacia el `.env` — P3
**Dónde:** `lib/services/billing/chipax-settings.ts:123-131,159-160`

**Qué pasa:** El `catch { logger.warn(...); return null }` seguido de `?? env.appId / ?? env.secretKey` no distingue «no hay nada guardado» de «hay algo guardado que no puedo abrir». La caída al entorno por BD caída es deliberada y está cubierta por prueba; la de fallo de **descifrado** no está cubierta y tiene consecuencias distintas: la credencial guardada existe, es la vigente, y se la reemplaza por la del `.env`, que por el propósito declarado del módulo suele ser la antigua. El portal DTE ante el mismo fallo propaga `DTE_SETTINGS_KEY_UNAVAILABLE` y falla cerrado (`decodeStoredDteSettings` no atrapa).

**Cómo se rompe:** Se despliega una réplica `app` olvidando `DTE_SETTINGS_KEYRING` (el compose lo deja vacío por defecto). Esa réplica lee `enc:v1:k1:…`, `decryptDteSetting` lanza, `openSecret` devuelve null y se autentica con la `CHIPAX_SECRET_KEY` vieja mientras las demás usan la nueva: 401 intermitente según qué réplica atienda el cron, y la pantalla muestra las credenciales como «heredadas del servidor», indistinguible de no haberlas guardado nunca.

**Impacto:** Credencial revocada contra la API contable y diagnóstico dirigido al lugar equivocado. Con `DTE_SETTINGS_MODE=encrypted_only` el resultado es el mismo: `readDteSettingsKeyring` lanza dentro del parámetro por defecto y el mismo catch lo traga.

**Arreglo:** Tratar `DteSettingsCryptoError` con código `DTE_SETTINGS_KEY_UNAVAILABLE`/`DTE_SETTINGS_DECRYPT_FAILED` como fallo duro: propagar, o devolver un centinela que ponga `hasCredentials = false` y un estado `configuration_error` en `ChipaxAdminStatus`. Un sobre presente que no abre nunca debe degradar al entorno. (La línea 119-122 ya falla cerrado ante un valor no cifrado, así que la asimetría es sólo con el sobre ilegible.)

---

### [CRED-04] La auditoría de cambios de credenciales se escribe fuera de la transacción — P3
**Dónde:** `lib/services/dte-portal/settings.ts:399,450,557,630` · `lib/services/billing/chipax-settings.ts:266,289`

**Qué pasa:** `recordAudit` acepta cliente (`recordAudit(params, client: AuditDb = db)`, `lib/audit.ts:25`) y podría correr dentro de la misma transacción, pero las seis rutas que tocan credenciales lo llaman después del commit. Si ese INSERT falla, el cambio del secreto ya está confirmado y `saveDteSettingsAction` (`settings-actions.ts:69-74`) devuelve «No fue posible guardar la configuración DTE».

**Cómo se rompe:** Se reemplaza `dte.clave`; la transacción confirma; el pool está saturado y el INSERT en `audit_log` lanza timeout. El usuario asume que nada cambió, cuando la contraseña persistida ya es la nueva, y no queda fila `dte_portal_settings/update`.

**Impacto:** Hueco en la trazabilidad de un cambio de credencial de acceso a evidencia tributaria, más un mensaje que contradice el estado real.

**Arreglo:** Pasar el `tx` a `recordAudit` en las seis funciones. Contexto: llamar a `recordAudit` fuera del tx es la convención del repo (67 de 69 llamadas en `lib/services`), así que esto es deuda sistémica — acótalo a estas seis rutas y no lo vendas como bug aislado.

---

### [CHX-03] Si `/dtes` deja de traer `paginationAttributes`, la corrida importa sólo la primera página y termina en `success` — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:416-420`

**Qué pasa:** Con array plano o envoltorio sin `paginationAttributes`, `totalPages` cae a 1, `nextCursor` es null y el `do…while (cursor)` de `sync.ts` termina tras una página. A la vez `reportedTotal` queda null, lo que desactiva la única guardia de pérdida del sync (`page.reportedTotal !== null && pages === 1 && ...`): el mismo cambio que trunca la lectura apaga el detector. El archivo documenta que el contrato publicado declara array plano y que se tolera «para no romperse si lo corrigen».

**Cómo se rompe:** Chipax alinea `/dtes` con su OpenAPI. Mes con 120 DTE: se leen 50, `errorsCount = 0`, corrida `success`, 70 facturas inexistentes en la plataforma. Hoy la API devuelve `{items, paginationAttributes}` y la paginación funciona (cubierto por prueba), así que el disparador es un cambio unilateral no observado.

**Impacto:** Pérdida silenciosa de documentos de venta presentada como corrida exitosa.

**Arreglo:** No inferir «una sola página» del silencio: `nextCursor = items.length >= DTE_PAGE_SIZE ? String(page+1) : null`, o marcar `INVALID_RESPONSE` cuando falte `paginationAttributes` y la página venga llena. Ojo: el comportamiento actual está asertado por `providers.test.ts`, así que el fix cambia contrato de pruebas.

---

### [CHX-04] Cartolas: mismo respaldo `pages ?? 1`, y `syncBankTransactions` ni siquiera compara el total declarado — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:435` · `lib/services/billing/sync.ts:312-470`

**Qué pasa:** `positivePageCount(envelope.pages ?? 1, page)` produce 1 ante array plano o falta de `pages` (hay prueba que asserta `nextCursor === null`). Peor que CHX-03 por dos razones: la solicitud no envía tamaño de página (`BANK_PAGE_SIZE = 500` es sólo techo de validación), y **`syncBankTransactions` no lee `page.reportedTotal` en ninguna línea** — la comparación total-declarado-vs-entregado sólo existe en `syncBillingInvoices`. Para cartolas no hay ningún detector de pérdida, ni siquiera cuando Chipax informa `total`.

**Cómo se rompe:** Un tenant/versión devuelve las cartolas como array plano (caso que el comentario del código declara soportar para «older tenants»). Con ~1.800 movimientos al mes se lee una página y el run cierra `success`. Con la forma real verificada (`{docs, pages, total}`) no hay pérdida hoy.

**Impacto:** Pérdida masiva de la fuente única de movimientos bancarios, presentada como corrida exitosa.

**Arreglo:** Separar la mitad barata y que no depende del proveedor: **usar `reportedTotal` en `syncBankTransactions`** para marcar `partial` cuando el total declarado no cuadre con lo leído (es lo que ya hace `syncBillingInvoices`). Después, la misma corrección de paginación de CHX-03 en `parseCartolaResponse`.

---

### [CHX-05] Un solo campo inesperado en un documento hace fallar la página completa — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:422`

**Qué pasa:** `items.map(parseDte)` valida todo-o-nada: cualquier fila con un campo null/ausente lanza `invalidResponse` y se pierde la página entera. El error sube por `get` → `listIssuedInvoices` → `fetchPage` al try/catch externo de `syncBillingInvoices`, que marca `failed`. Contradice `docs/facturacion/INTEGRACIONES.md:45` («Un documento que falla no aborta la corrida; se cuenta y se reporta») y `SINCRONIZACION.md:14`. `parseDte` contempla null sólo en `fechaVencimiento`.

**Cómo se rompe:** Una factura exenta con `iva: null` o una boleta sin RUT de receptor. Se descarta la página completa y todas las siguientes (las anteriores sí quedan importadas, porque cada upsert va en su propia transacción). Como el dato no cambia, el cron falla igual todas las mañanas. Sin evidencia en el repo ni en `docs/facturacion/CHIPAX.md` de que la API devuelva esos nulos — lo habitual es 0.

**Impacto:** Un dato de borde bloquea la ingesta del resto del mes en vez de dejar 45 documentos importados y 1 reportado como conflicto.

**Arreglo:** Parsear fila por fila tolerando el fallo individual, contar `invalidRows` y sumarlos a `conflictsDetected` dejando la corrida `partial` con el detalle. (Nota: el rechazo total-o-nada es intencional, fail-closed frente a mapear basura; hay prueba que lo fija.)

---

### [CHX-06] Un 429 sin cabecera `Retry-After` se reintenta de inmediato — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:292`

**Qué pasa:**
```ts
const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
if (retryAfter > 0) await new Promise(r => setTimeout(r, retryAfter))
return this.get<T>(path, retry401, false)
```
`parseRetryAfter(null)` devuelve 0 en su primera línea, así que sin cabecera no hay espera: el reintento sale tras los ~1,1 s de `space()`, casi con certeza dentro del mismo minuto que gatilló el límite de 60/min. El segundo 429 lanza `RATE_LIMITED` y aborta la corrida. `docs/facturacion/CHIPAX.md:164-165` promete el máximo de 30 s; el mínimo no está implementado.

**Cómo se rompe:** Una sincronización manual del histórico corre en paralelo con el cron (instancias distintas de `ChipaxProvider`, cada una con su `lastRequestAt`). Se supera el límite en el segundo 20 y Chipax responde 429 sin cabecera: reintento a 1,1 s, otro 429, corrida `failed`, cuando bastaban 40 segundos.

**Impacto:** Corridas abortadas por un límite transitorio; con el cron diario, un mes puede quedar sin sincronizar hasta el día siguiente. Sin pérdida definitiva (cursor durable).

**Arreglo:** Piso al backoff cuando falta la cabecera: `retryAfter > 0 ? retryAfter : min(60_000 - (Date.now() % 60_000), MAX_RETRY_AFTER_MS)`, o un fijo de ~15 s. El reintento sigue siendo único.

---

### [CHX-07] Una respuesta 200 con cuerpo no-JSON produce un error genérico sin causa — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:313`

**Qué pasa:** `return (await response.json()) as T` sin try/catch. Todos los caminos de error HTTP construyen un `BillingProviderError` con contexto, pero un 200 con cuerpo no-JSON lanza un `SyntaxError` crudo, y `redact()` (`sync.ts:649-655`) sólo conserva el mensaje de `DtePortalError` y `BillingProviderError`. Además el `logger.error` de esa rama registra el mensaje **ya redactado**, así que el original no sobrevive ni en los logs.

**Cómo se rompe:** El proxy delante de `api.chipax.com` devuelve 200 con un HTML de mantención. La corrida queda `failed` y el historial muestra sólo «El proveedor no completó la sincronización [detalle técnico omitido]» — indistinguible de un bug del adaptador, un timeout o un problema de base de datos.

**Impacto:** Diagnóstico ciego en la falla más probable de una integración externa.

**Arreglo:** `try { return await response.json() as T } catch { invalidResponse(\`cuerpo no es JSON en ${path.split("?")[0]}\`) }`.

---

### [CHX-08] `DTE_PAGE_SIZE` está cableado como validación dura — P3
**Dónde:** `lib/services/billing/providers/chipax.ts:418`

**Qué pasa:** `if (!Array.isArray(items) || items.length > DTE_PAGE_SIZE) invalidResponse("/dtes: items inválidos o sobre el límite de 50")`. El comentario de la constante lo describe como «tamaño de página observado; la API no permite cambiarlo», y la solicitud no lo envía: es una observación del servidor convertida en condición de rechazo, sin holgura. `BANK_PAGE_SIZE = 500` sí es un límite defensivo desacoplado.

**Cómo se rompe:** Chipax sube la página a 100. La primera respuesta trae 100 documentos correctos y el adaptador lanza; todas las corridas de ventas quedan `failed` hasta que se despliegue código.

**Impacto:** Caída total de la ingesta de ventas por un cambio benigno. Atenuante: es fail-closed y ruidoso, con mensaje explícito, así que el diagnóstico es inmediato.

**Arreglo:** Subir el techo a un valor defensivo (1.000, como cartolas) y dejar que `totalPages` gobierne la paginación. Una línea, sin cambio de comportamiento actual.

---

### [VTA-02] `enrichFromXml` injerta los datos del XML sin verificar que sea el mismo documento — P3
**Dónde:** `lib/services/billing/providers/factura-en-linea.ts:222-251` · `lib/services/billing/dte-xml.ts:73,182-198`

**Qué pasa:** `enrichFromXml` copia `receiverTaxId`, `receiverName`, `dueDate`, montos e ítems sin comparar `parsed.folio`, `parsed.docType` ni `parsed.issuerTaxId` contra la fila que enriquece. Y `findDescendant` es un BFS que devuelve la **primera** aparición de `Documento`: verificado ejecutando fast-xml-parser 5.10.1 sobre un `EnvioDTE` con dos `<DTE><Documento>`, el segundo se descarta en silencio. No hay guardia aguas abajo: `upsertProviderInvoice` construye la identidad con el `receiverTaxId` injertado.

**Cómo se rompe:** Requiere que el portal sirva un sobre multi-DTE en el enlace XML de una fila. No consta: `extractXmlUrl` devuelve la URL de `estadodoc.php` con folio/tipodoc de esa fila, y el único sobre real del repo declara `<SubTotDTE><NroDTE>1</NroDTE>`. Si ocurriera, la venta quedaría facturada al cliente equivocado con vencimiento y montos del otro documento, y la corrida cerraría `success`.

**Impacto:** Validación faltante sobre entrada externa no confiable en el punto donde se construye la identidad tributaria.

**Arreglo:** Dos líneas: `if (parsed.docType !== invoice.docType || parsed.folio !== invoice.folio || parsed.issuerTaxId !== invoice.issuerTaxId) { logger.warn(...); return }`. Complementario: que `parseSaleDteXml` acepte un selector y recorra todos los `<Documento>`, o devuelva null si encuentra más de uno.

---

### [VTA-03] El cursor de XML de ventas puede dejar fuera para siempre un documento con fecha anterior al cursor — P3
**Dónde:** `lib/services/billing/sales-xml-cursor.ts:69-72` · `lib/services/billing/sync.ts:643-646`

**Qué pasa:** La clave es `[issueDate, docType, folio, externalId].join("|")`, ordenada por fecha de emisión, y el selector sólo toma `key > cursor`. El salvavidas de wrap-around (`after === -1 → start = 0`) actúa sólo cuando **ningún** candidato supera el cursor. Con un candidato nuevo por debajo y otro por encima, el de abajo se descarta. Y `resumableCursor` mantiene el cursor pinchado mientras la corrida no cierre `success`.

**Cómo se rompe:** Cursor en `2026-07-14|033|…1180`. `ordered = [key(2026-07-03, folio 1300), key(2026-07-28, folio 1210)]`. `findIndex` devuelve 1 → `start = 1` → sólo se selecciona el 1210, cuyo XML el portal sirve corrupto → `retryRequired` → el cursor no avanza → la venta folio 1300 nunca baja su XML, nunca obtiene `receiverTaxId` y se cuenta como conflicto «sin RUT» en cada corrida sin insertarse jamás.

**Impacto:** Venta permanentemente fuera de las cuentas por cobrar mientras exista un documento envenenado en la cola. El operador sólo ve «N sin RUT resuelto», el mismo mensaje que produce un documento sin `xmlUrl`. Requiere la conjunción de las dos condiciones: sin el documento envenenado el sistema se autorrepara en la corrida siguiente.

**Arreglo:** `ordered.filter(c => c.key > cursor)` y, si el lote no llena el límite, completarlo con los `<= cursor`. Alternativa: dejar de reescribir `initialCursor` cuando la causa del `partial` es un candidato ya reintentado N veces.

---

### [VTA-05] `redact()` borra los mensajes de error internos del propio motor — P3
**Dónde:** `lib/services/billing/sync.ts:649-655`

**Qué pasa:**
```ts
if (error instanceof DtePortalError) return classifyDteFailure(error).summary
if (error instanceof BillingProviderError) return error.message.slice(0, 500)
return "El proveedor no completó la sincronización [detalle técnico omitido]."
```
Los errores por documento vienen de `upsertProviderInvoice`, o sea de código propio: `BillingExternalReferenceConflict`, `BillingExternalReferenceInvalid`, el 23505 de `billing_external_refs_invoice_provider_unique`, «sin RUT de emisor o receptor». Ninguno es de esas dos clases y ninguno contiene respuesta externa ni credenciales: la redacción no protege nada y destruye el único diagnóstico persistido en `billing_sync_runs.error_summary`. El `logger.error` de esa rama registra el mensaje ya redactado.

**Cómo se rompe:** «La referencia externa factura_en_linea/fel:sale:433:33:1234:78023530-6 ya pertenece a otra factura interna; se rechaza la reasignación» se convierte en el texto genérico. El operador concluye que el portal está caído y revisa credenciales y red.

**Impacto:** Diagnóstico falso dirigido al componente equivocado — el mismo tipo de defecto que el archivo dice haber corregido en H-09.

**Arreglo:** Propagar el mensaje de las clases propias y, para el resto, conservar `code`/`constraint` del driver (23505 + nombre del índice) en vez del texto genérico.

---

### [VTA-06] El signo de nota de crédito no se aplica a los ítems — P3
**Dónde:** `lib/services/billing/dte-xml.ts:99-135`

**Qué pasa:** `asCredit` se aplica sólo a los cuatro montos de `<Totales>`. `MontoItem`, `PrcItem` y `DescuentoMonto` se leen con `num()` sin invertir, y ambos adaptadores los copian tal cual a `netAmount`/`totalAmount` del ítem (`factura-en-linea.ts:239-250`, `manual.ts:91-99`), persistidos en `billing_invoice_items`.

**Cómo se rompe:** El fixture real (NC folio 376999): la factura queda con `totalAmount -467.417` y su único ítem con `netAmount = +392.787`. `dte-xml.test.ts:210` ya fija ese descuadre como comportamiento actual.

**Impacto:** Detalle contradictorio con el encabezado en toda NC. Hoy **nadie suma los ítems** (`queries.ts:424` sólo los lee para la vista de detalle y `export.ts` no los toca), así que el único síntoma es la tabla de líneas mostrando importes positivos bajo un encabezado negativo.

**Arreglo:** Aplicar `asCredit` también a `amount`, `unitPrice` y `discount` al construir cada `DteXmlItem`, o documentar explícitamente que los ítems son magnitudes y que quien los sume consulte el `docType`.

---

### [VTA-07] La moneda se fija en CLP sin leerla del documento, incluidos los tipos de exportación — P3
**Dónde:** `lib/services/billing/providers/factura-en-linea.ts:308`

**Qué pasa:** `currency: "CLP", // el portal opera en pesos; el XML lo confirmaría` — pero `parseSaleDteXml` no lee `<Moneda>` ni `<OtraMoneda>`, así que `enrichFromXml` no puede corregirlo: el comentario describe algo que el parser no hace. El catálogo TipDoc (`parser.ts:62-64`) incluye 110/111/112 (exportación), así que esas filas pueden aparecer en el libro de ventas. `currency` es `text` con default `'CLP'`, sin check.

**Cómo se rompe:** Factura de exportación 110 por USD 5.000 listada con `montoTotal 5.000` → se guarda `totalAmount = 5.000` con `currency = "CLP"`. El dashboard suma 5.000 pesos en vez de ~4.750.000. No consta en el repo si el portal lista los documentos de exportación en moneda extranjera o en su equivalente CLP, así que la magnitud es una asunción.

**Impacto:** Etiqueta de moneda falsa. A favor del módulo: `reconciliation.ts:99` sí compara monedas antes de emparejar (`if (invoice.currency !== transaction.currency) continue`), así que el conciliador no las mezcla por descuido — el problema es que la etiqueta miente.

**Arreglo:** Leer `Encabezado/Totales/TpoMoneda` (o `Encabezado/OtraMoneda/TpoMoneda`), exponerlo en `DteXmlDocument` y asignarlo en `enrichFromXml`. Si el XML no está y el docType es 110/111/112, contar el documento como conflicto en vez de asumir CLP.

---

### [MON-05] El detector de duplicados agrupa por el RUT crudo, anulando la normalización de `classifyPair` — P3
**Dónde:** `lib/services/billing/duplicates.ts:167`

**Qué pasa:** `const key = \`${invoice.issuerTaxId}|${invoice.receiverTaxId}|${invoice.currency}\`` usa los RUT sin normalizar, mientras `classifyPair` (:89-91) sí aplica `cleanRut` con el comentario que declara el motivo («un RUT con puntos en una fuente y sin puntos en otra lo dejaba ciego»). Como `classifyPair` sólo se llama con pares del mismo grupo, esa defensa es código muerto para el caso que la motivó.

**Cómo se rompe:** Fila histórica `receiver_tax_id = '76.543.210-K'` folio 1001 y fila nueva `'76543210-K'` folio 1055, mismo monto y fecha → dos grupos de tamaño 1 → `continue`. El par queda invisible en `/facturacion/duplicados`. Con los datos que el código puede escribir hoy no se pierde ningún par: todos los caminos de inserción normalizan (`factura-en-linea.ts:129/327/333`, `chipax.ts:332-334`, `parseSaleDteXml` vía `dte-xml.ts:89-91`). Sólo muerde con filas anteriores a esa normalización, cuya existencia no se verificó en este checkout.

**Impacto:** El mismo documento duplicado sin que el motor lo marque; pagos repartidos entre dos filas que nadie sabe que son la misma.

**Arreglo:** `const key = \`${cleanRut(invoice.issuerTaxId)}|${cleanRut(invoice.receiverTaxId)}|${invoice.currency}\`` (`cleanRut` ya está importado). Caso RUT punteado vs. sin puntos en `duplicates-integration.test.ts`.

---

### [MON-06] Las facturas sobrepagadas restan del total por cobrar y se muestran como vencidas — P3
**Dónde:** `lib/services/billing/collections.ts:243,264-271,277-280,102-119`

**Qué pasa:** `outstandingAmount = addAmounts(row.totalAmount, -row.paidAmount)` es negativo en `overpaid`, y el filtro de `totalOutstanding` excluye sólo `paid`, así que las sobrepagadas netean contra el saldo de las demás. `classifyCollection` evalúa `daysOverdue > 0` antes que nada y sólo devuelve `paid` con `paymentStatus === 'paid'`, de modo que una sobrepagada vencida cae en «Vencidas» arrastrando su saldo negativo.

**Cómo se rompe:** Factura A: total 1.190.000, pagada 1.200.000, vencida hace 5 días. Factura B: total 500.000, impaga, vencida. El bucket «Vencidas» muestra 2 facturas y 490.000, cuando lo pendiente son 500.000 y además hay 10.000 por devolver.

**Impacto:** «Total por cobrar» y subtotales subestimados, y una factura que requiere devolución listada como deuda del cliente.

**Arreglo:** Filtrar también `paymentStatus !== "overpaid"` (o acotar con `Math.max(0, outstanding)`) y darle a `overpaid` su propio bucket en `classifyCollection`/`COLLECTION_BUCKETS`, igual que ya existe `paid`.

---

### [CMP-01] `downloadDteDocumentXml` persiste neto/IVA y el archivo XML sin verificar que sea el del documento pedido — P3
**Dónde:** `app/(app)/compras/actions/dte-download-xml.ts:88-105`

**Qué pasa:** `parseDteXml` ya devuelve `tipoDte`, `invoiceNumber` y `supplierRut` (`dte-parser.ts:22-31`), pero la acción no compara ninguno contra la fila antes de escribir `montoNeto`, `iva` y `xmlPath`; el `findFirst` ni siquiera trae `montoTotal`. La verificación de identidad vive aguas abajo (`invoices.ts:338-350`, `hasSameIdentity` → «El XML descargado no corresponde al DTE seleccionado»), y esa transacción **no revierte** la escritura ya commiteada de esta acción. `readCachedXml` tampoco revalida.

**Cómo se rompe:** Requiere que el portal sirva otro documento en `PRV_<rut>_<tipo>_<folio>.xml`. Como la URL ya está determinada por tres de las cuatro columnas de la clave única, eso depende por completo de CMP-09 (un segundo `codEmp`), que hoy no existe. Si ocurriera, la fila quedaría con neto+IVA de un documento y `monto_total` de otro, con el XML ajeno cacheado para siempre.

**Impacto:** Defensa en profundidad ausente y escritura no idempotente frente al rollback de la factura, en campos que se exportan tal cual en el Libro de Compras.

**Arreglo:** Antes del `db.update`, comparar `parsed.tipoDte === doc.tipoDte && Number(parsed.invoiceNumber) === doc.folio && cleanRut(parsed.supplierRut ?? "") === cleanRut(doc.rutEmisor)`; si no calza, borrar el archivo y devolver error sin escribir. Es la misma comprobación de `invoices.ts:340`, movida al punto donde se persiste. Añadir `montoTotal` a las columnas del `findFirst`.

---

### [CMP-07] El endpoint de PDF dispara un raspado completo de la Bandeja del mes por petición de usuario — P3
**Dónde:** `lib/services/dte-portal/purchase-document-pdf.ts:108-160`

**Qué pasa:** `GET /api/purchase-orders/dtes/[id]/pdf` sólo exige sesión + `purchasing:view`. Para un DTE con `portal_record_id` nulo el camino es `fetchBandejaEntrada`, la consulta más cara del portal (`config.ts:32-36`: «~80s… verificado: 681 documentos», con timeout de 120 s). El `delayMs` de 500 ms es por instancia de `DtePortalClient` y aquí se crea una por petición; `withDtePortalOperationLease` (`operation-lease.ts:53-97`) sólo inserta una fila con expiración, no serializa ni limita concurrencia.

**Cómo se rompe:** Acotado por dos autocuraciones que el escenario ingenuo ignora: `upsertDteDocument` hace backfill de `portalRecordId` en cada re-sync del período (`sync.ts:385-401`, `needsPortalRecordBackfill`), y una búsqueda exitosa persiste `portalRecordId` y cachea el PDF. El raspado repetido queda limitado a las filas legadas que nunca calzan exactamente (`matches.length !== 1`), que además son las que ya no tienen PDF utilizable.

**Impacto:** Amplificación contra el proveedor con credenciales de la empresa, acotada al subconjunto legado. Cada petición ata una conexión hasta 120 s.

**Arreglo:** Persistir también el resultado negativo (`portal_record_lookup_failed_at`) para no repetir el raspado. Alternativa mínima: backfill único de `portal_record_id` y 404 en la ruta cuando falte, sin fallback en línea.

---

### [CMP-08] `prefillInvoiceFromDte`: server action sin llamador que no ata el DTE a la OC ni a su proveedor — P3
**Dónde:** `app/(app)/compras/actions/dte-prefill-invoice.ts:49`

**Qué pasa:** Grep completo: los únicos usos son su definición y su test. No está en `app/(app)/compras/actions/index.ts` (que sí re-exporta `downloadDteDocumentXml` y `attachDteAsInvoice`) y `invoices-section.tsx` importa sólo `attachDteAsInvoice`. La firma no recibe `purchaseOrderId`: no hay `assertOrderAccess`, ni comparación de RUT contra el proveedor de la OC, ni el piso por `order.createdAt`. La única guarda es `if (doc.purchaseOrderInvoiceId)`, que ni siquiera cubre `fuelLoadId`. El mensaje «Este DTE ya está vinculado a una factura de esta orden» ya miente: la acción no sabe de qué orden habla.

**Cómo se rompe:** Hoy inalcanzable. Si alguien lo cablea al formulario tal cual —que es para lo que está escrito— cualquier usuario con `purchasing:send_order` recibe folio, RUT, razón social, neto, IVA, total y todas las líneas de cualquier DTE de la organización, incluido uno ya imputado a combustible.

**Impacto:** Código muerto cuya forma invita a introducir un IDOR de datos tributarios el día que se conecte.

**Arreglo:** Borrarlo junto con su test (el flujo real es `attachDteAsInvoice`), o darle la firma `{ purchaseOrderId, dteDocumentId }` y reusar las guardas de `attachDteAsInvoice`.

---

### [CMP-09] La ruta del XML hardcodea la carpeta de empresa `Chome` mientras `codEmp` es configurable — P3
**Dónde:** `app/(app)/compras/actions/dte-download-xml.ts:70`

**Qué pasa:** `` const relativeUrl = `empr/Chome/DTEProveedores/PRV_${doc.rutEmisor}_${doc.tipoDte}_${doc.folio}.xml` ``. `codEmp` gana desde `system_settings` (`config.ts:105`, editable en Administración) y forma parte de `dte_documents_unique_key` precisamente porque un mismo tipo/folio/RUT puede existir para dos empresas. El camino del PDF sí lo respeta (`buildDtePurchasePdfUrl(doc.codEmp, doc.portalRecordId)`); el del XML no lo usa en absoluto: dos filas que sólo difieren en `codEmp` resuelven a la misma URL.

**Cómo se rompe:** Se configura un segundo `codEmp` y se sincroniza su período. Al pedir el XML de un DTE de esa empresa, o 404 para todos sus documentos, o —si el emisor factura a ambas con el mismo tipo/folio— se baja el documento de la otra empresa y se persiste como si fuera éste (ver CMP-01).

**Impacto:** El registro de facturas desde DTE deja de funcionar para cualquier empresa distinta de la actual y, en el peor caso, mezcla evidencia entre razones sociales. Latente: hoy hay un solo juego de credenciales.

**Arreglo:** `Chome` **no** es derivable de `codEmp` (un número), así que la corrección completa exige un mapa `codEmp → carpeta` en configuración. Variante mínima segura: rechazar la descarga cuando el `codEmp` de la fila no sea el configurado. Validar `rutEmisor` con regex antes de interpolarlo (el folio es `integer` en el esquema, no hace falta).

---

### [API-01] El dashboard de Flota lee la configuración DTE sin protección: un keyring roto tumba toda la sección — P3
**Dónde:** `app/(app)/dashboard/sections/fleet-section.tsx:41` (mismo hueco en `finance-section.tsx:66`)

**Qué pasa:** `const dteCodEmp = (await readDtePortalConfig()).credentials.codEmp` está fuera del `Promise.all` y sin catch; el `.catch(() => null)` sólo cubre `countPendingFuelCreditNotes`. `readDtePortalConfig` llama a `readStoredDteSettingsStrict()` (lanza `DteSettingsReadError`) y a `readDteSettingsKeyring()` (lanza `DTE_SETTINGS_MODE_INVALID` / `KEYRING_INVALID` / `KEYRING_REQUIRED`). No hay error boundary por sección: `page.tsx:186` envuelve la vista en un solo `Suspense` (que no captura errores) y el único límite es `dashboard/error.tsx`. El patrón correcto ya existe en `app/api/cron/dte-sync-health/route.ts:33-43`.

**Cómo se rompe:** Durante una rotación el operador pega mal el JSON de `DTE_SETTINGS_KEYRING`. Cualquier usuario con `flota:view`, `combustibles:view` o `mantenciones:view` ve «Error al cargar el panel» en lugar de litros, documentos por vencer y mantenciones vencidas.

**Impacto:** Pérdida del tablero operacional para roles que no tienen nada que ver con DTE, por un error de configuración de otra integración. Sólo alcanzable con mala configuración de entorno, visible de inmediato en el despliegue.

**Arreglo:** `const dteCodEmp = await readDtePortalConfig().then(c => c.credentials.codEmp).catch(() => null)` y saltar el tile cuando sea null (el render ya soporta `pendingFuelCreditNotes === null`). Igual en `finance-section.tsx`.

---

### [API-06] El tile de NC de combustible expone datos DTE a roles sin `purchasing:view` y enlaza a una página que les responde 403 — P3
**Dónde:** `app/(app)/dashboard/sections/fleet-section.tsx:105-112`

**Qué pasa:** La sección Flota se muestra con cualquiera de `["combustibles:view","flota:view","mantenciones:view"]` (`dashboard-domains.ts:82`, `.some(...)`) y el tile sólo se condiciona a `pendingFuelCreditNotes !== null`; `permissions` está disponible pero sólo se usa para `combustibles:view_costs`. `countPendingFuelCreditNotes` es una consulta cruda sin comprobación de sesión. El destino exige `purchasing:view` (`compras/dte/page.tsx:34-35` redirige a `/forbidden`). El gemelo de Finanzas sí lo condiciona (`finance-section.tsx:66`).

**Cómo se rompe:** Un jefe de faena con sólo `flota:view` ve «NC de combustible sin aplicar: 7» y al hacer clic aterriza en `/forbidden`.

**Impacto:** Fuga menor de información del módulo de compras y callejón sin salida en la navegación.

**Arreglo:** `const canSeePurchasing = permissions.includes("purchasing:view")` y usarlo tanto para la llamada como para incluir el tile, igual que `finance-section.tsx`.

---

### [API-08] No hay tope global de concurrencia contra el portal DTE — P3
**Dónde:** `lib/services/dte-portal/operation-lease.ts:69-96` · `lib/services/dte-portal/client.ts:207-212`

**Qué pasa:** `acquireDtePortalOperationLease` toma el advisory lock, revisa el cerco de cutover, borra expirados e **inserta el suyo** — nunca cuenta ni rechaza por leases vivos: es barrera de cutover, no semáforo. El único freno de ritmo es `private async throttle()`, que compara contra el `lastRequestTime` de **esa** instancia, y cada caller construye su propio `new DtePortalClient(...)`. El único candado real es `uniqueIndex("dte_sync_runs_single_active_unique").on(codEmp, periodo)`, que sólo cubre el mismo período.

**Cómo se rompe:** El escenario de «100 descargas de XML en paralelo» **no** aplica: no hay UI de descarga masiva y las server actions de un cliente se serializan. La variante creíble es 12 POST a `/api/dte-portal/sync` con `periodo=2025-01..2025-12` (permiso `admin:dte_sync`) o varias sesiones/instancias a la vez: 12 raspados concurrentes, porque el índice sólo bloquea el mismo período.

**Impacto:** Riesgo de throttling o bloqueo de la cuenta del portal, que dejaría a toda la organización sin sincronización de compras ni XML/PDF de respaldo.

**Arreglo:** Convertir el lease en semáforo: dentro de la misma transacción con `pg_advisory_xact_lock`, contar leases vivos y rechazar (o esperar) por sobre un tope pequeño — 2 — antes de insertar el propio. Es el único punto por el que pasan sync, descargas y health.

---

## 4. Estado por módulo tocado

| Módulo | Cómo lo toca la integración | Riesgo | Hallazgos |
|---|---|---|---|
| **Compras** | `dte_documents` es la fuente de la factura de OC: `attachDteAsInvoice`, `selectDteCandidates`, XML/PDF bajo demanda, listado `/compras/dte` | **Alto.** El camino manual está bien blindado (RBAC, faena, identidad XML↔fila, `FOR UPDATE`, índice único). El daño está en el camino automático y en los estados terminales: cancelar una OC deja el DTE atrapado sin ruta de salida, y el auto-match no aplica el piso de fecha que las dos rutas manuales sí exigen. La lista corta en 300 de 681 sin avisar. Pendiente de rendimiento no reportado: `unlinkedDtes` en `compras/[id]/page.tsx:216` trae todos los 33/34 sin vincular desde la creación de la OC, sin límite ni filtro de proveedor en SQL | REC-01, REC-02, REC-04, REC-05, CMP-01, CMP-07, CMP-08, CMP-09, API-02, PAR-05 |
| **Combustibles** | `matchToFuelLoads` vincula `dte_documents.fuel_load_id` contra `fuel_loads` por `receiptNumber`+RUT del proveedor | **Alto y estructural.** Es el lado sin defensas: sin índice único, sin lock, sin guarda de ocupación; la carga se puede editar libremente rompiendo el vínculo y no se puede borrar (error crudo de PG); el módulo ni siquiera muestra que el DTE existe. Y el caso de mayor volumen —factura TAE mensual con N líneas— es estructuralmente inconciliable con un modelo 1:1 | REC-03, REC-07, CMP-06 |
| **Facturación / Cobranza** | Chipax y FEL ingestan ventas; cartolas de Chipax alimentan `proposeMatches`; `derivePaymentStatus` deriva el estado de pago | **Crítico.** Aquí están los tres defectos de dinero activos: NC en positivo, cargos bancarios propuestos como abono, pago negativo que marca pagada. Más: el total corregido por el proveedor no recalcula el estado, y el cursor de referencias externas puede atascar la corrida sin diagnóstico | CHX-01, CHX-02, MON-01, MON-02, MON-04, MON-05, MON-06, VTA-02..VTA-07, CHX-03..CHX-08 |
| **Dashboard** | `computeHealthStats` (Finanzas), `countPendingFuelCreditNotes` (Flota), `readDtePortalConfig` en ambas | **Bajo.** Nada de esto calcula plata, pero: una consulta de ~681 filas por render cuyo resultado se descarta, una nota que desacredita cifras correctas, un tile que expone datos de compras a roles de flota, y una lectura de configuración sin catch que puede tumbar la sección completa | REC-08, API-01, API-06 |
| **Reportes** | `dte-libro-compras`, `dte-conciliacion`, `dte-facturas-sin-oc` (llaveados por `codEmp` vivo); `billing-cobranza` | **Medio-alto.** El Libro de Compras Electrónico se entrega sin Neto ni IVA en casi todas las filas, y sale **vacío con HTTP 200** si el `codEmp` configurado cambia o se borra. El export de cobranza no se audita y las hojas por cliente/faena sobrecuentan con multivínculo | CMP-05, API-03, API-04, MON-03 |
| **Ingesta (portal → `dte_documents`)** | La Bandeja de Entrada es la única fuente; la ventana automática son dos períodos por fecha de emisión | **Alto.** Aquí está la fuga estructural: un DTE enviado con más de dos meses de atraso no se consulta nunca y la salud reporta `healthy`. Además dos columnas de estado están al revés — `estado_sii` se escribe siempre `null` con ocho lectores encima (incluida la exportación tributaria), y `estado_plataforma` sí se puebla y no lo lee nadie, así que un documento reclamado se auto-concilia | ING-01, ING-02, ING-03 |
| **Respaldos / Recuperación** | El keyring que descifra las credenciales de portal y Chipax vive sólo en el entorno; los sobres viven en la base | **Crítico en el peor momento.** Los dos extremos están mal: la rama que corre en producción respalda el ciphertext y descarta la llave, y la rama que sí la incluye la sube a Drive sin cifrar junto al dump que esa llave abre — con las credenciales del propio destino en el mismo tar | BKP-01, BKP-02 |
| **Operación / Procedimientos** | Runbooks de rollback y sincronización, scripts de seed, semáforo de salud del proveedor | **Medio.** El Nivel 4 del rollback publicado deja un CHECK obsoleto que rompe la reversión de pagos; un script de demo trunca toda la facturación sin guardia de entorno; y el estado «Con problema» del proveedor no vence nunca, lo que enseña a ignorar el rojo | DOC-01, OPS-01, OPS-02 |
| **Admin** | `/admin/dte` (credenciales, keyring, forzar sync), diálogo de Chipax | **Medio.** La criptografía es correcta y no hay fuga al cliente. Los dos huecos son operativos: el re-cifrado del keyring olvida los sobres de Chipax (que quedan ilegibles al retirar la clave vieja), y sin keyring la pantalla guarda la clave del portal en claro sin advertirlo. Además el motivo de una corrida `partial` existe en la BD y no se puede leer desde la única pantalla a la que apunta la alerta | CRED-01, CRED-02, CRED-03, CRED-04, ORQ-01..ORQ-06, API-08 |

## 5. Descartado (no re-auditar)

| Ítem | Por qué NO es bug |
|---|---|
| **VTA-01** — «`enrichFromXml` nunca aplica `MntTotal`: una NC de venta queda con total positivo y neto/IVA negativos» | El hecho de código es cierto, el escenario no ocurre: el **libro de ventas** del portal ya entrega los montos de una NC en negativo. El fixture real (`paneldte-compras-periodo.html.ts`, capturado 2026-08-04) trae la fila de NC con `-50.000` y `-59.500`, y `parseMonto` conserva el signo. `parser.test.ts:36` lo fija: `montoNeto -50000`, `montoTotal -59500`. `mapSaleRow` produce total negativo y el XML queda consistente. No hay inflado por esta vía. (Distinto de CHX-01, que es el listado de **Chipax**.) |
| **DTE-API-07** — «`countPendingFuelCreditNotes` cuenta como sin aplicar NC ya vinculadas a una factura de OC» | Inalcanzable: un tipo 61 nunca puede tener `purchaseOrderInvoiceId`. Sólo dos rutas escriben esa columna: `invoices.ts:238`, precedida por `validateDteForInvoiceTx` que rechaza todo lo que no sea 33/34 bajo `FOR UPDATE`; y `linkDteToPurchaseOrderInvoice`, llamada sólo desde `matchInvoiceToDteDocument`, cuyos candidatos se filtran con `inArray(tipoDte, ["33","34"])`. Agregar `isNull(purchaseOrderInvoiceId)` no cambiaría ningún conteo. |
| SSRF hacia el portal | `assertDtePortalBaseUrl` + `resolveDtePortalResourceUrl` cierran host, esquema, puerto explícito (revisando la autoridad cruda), userinfo `@`, `//` protocol-relative, backslashes, prefijo de path y traversal con 3 pasadas de decodificación. Probado contra `https://host@evil.com` y rutas `../`; ya hay test de `client.get("https://evil.example/metadata")`. |
| Fuga de credenciales por logs, errores o Sentry | `normalizeError` → `sanitizeErrorMessage` devuelve constante; `classifyDteFailure` mapea a códigos fijos; `lib/logger.ts` redacta por clave, enmascara RUT/email y reemplaza sobres `enc:v1:`; `redact()` de Chipax filtra app_id/secret_key/token; el e2e `facturacion.spec.ts` asegura que ninguna respuesta contenga `clave=`/`rut_usr`. El único hueco es PAR-07, y hoy no filtra. |
| Límite en la descarga binaria | `downloadBinary` chequea `content-length` **y** corta en streaming (`readBinaryResponse` cancela el reader), que es lo correcto porque el header puede faltar. El hueco de tamaño está sólo en el camino HTML (PAR-02). |
| Path traversal en `xmlPath`/`pdfPath` | Cerrado: `resolveDteFile`/`createDtePath` pasan por `isSafeStorageName` y el prefijo `storage/dte/`; los nombres se generan, nunca vienen del portal; los PDF se revalidan por firma + apertura con pdfjs; escritura atómica (`wx` a `.tmp` + `rename`). |
| Zona horaria UTC vs Chile | `chile-time.ts` usa `Intl.DateTimeFormat` con `en-CA` + `America/Santiago` + `hourCycle:"h23"`; `previousChilePeriod` cruza el año bien; `rollingSyncPeriods` cruza enero (2026-01 → 2025-12); `localDateToISO` con `TZ=America/Santiago` fijado en los tres servicios del compose. No hay corrimiento explotable en ninguna de las dimensiones. |
| Autenticación de cron | Las 19 rutas `/api/cron/*` usan `verifyCronSecret` con `timingSafeEqual` tras igualar longitudes y fallan cerradas sin `CRON_SECRET`. El crontab enmascara el secreto al imprimirse y el runner nunca lo loguea. |
| `claimDteSyncStart` / doble raspado del mismo período | Barrera + INSERT `running` en una transacción con `pg_advisory_xact_lock` y `onConflictDoNothing()` sin target: «ya hay corrida activa» se distingue de un fallo de base, que se propaga (hay test). El botón manual y el cron no pueden raspar dos veces el mismo `(codEmp, periodo)`. |
| Corridas `running` huérfanas bloqueando para siempre | No ocurre: `markStaleRunsAsFailed` corre al inicio de cada sync del mismo codEmp y libera el índice parcial a la hora. El defecto real es el opuesto (ORQ-04). |
| `linkDteToPurchaseOrderInvoice` (lado OC) | Correcto: transacción, `SELECT ... FOR UPDATE`, consulta de ocupación, UPDATE condicional e `isUniqueViolation` que desenvuelve `cause` hasta 5 niveles buscando 23505 y salta el documento en vez de reventar la corrida. Sin ciclo de deadlock con la ruta manual. |
| `validateDteForInvoiceTx` | La validación más estricta del sistema: `FOR UPDATE` sobre el DTE, rechazo de tipos ≠ 33/34, rechazo si ya está ocupado, RUT normalizado contra el proveedor de la OC, piso de fecha con `localDateToISO`, identidad completa contra el XML descargado en servidor con tolerancia de 1 CLP. No hay IDOR de proveedor por este camino. |
| Vincular un DTE de $5.000.000 a una factura de $50.000 | Imposible por el camino manual: el monto de la factura **es** el `MntTotal` del DTE (`amountAuthority: "document_header"`) y se contrasta contra `dte.montoTotal`. La divergencia contra el total de la OC es deliberadamente sólo advertencia (`reconcileOrderInvoices` → warnings, y el cierre exige confirmación explícita). |
| `scripts/repair-dte-single-link.ts` | Seguro: por defecto sólo reporta; `--apply` exige `--mapping` con decisión explícita por cada DTE, rechaza decisiones sobre DTE sin conflicto, relee bajo `FOR UPDATE`, aborta si el estado cambió respecto del reporte, y audita oldState/newState. `preflight` es de sólo lectura y trata 42P01 como base nueva. |
| `matchToPurchaseOrderInvoices` línea 214, rama `if (!key.startsWith("|") …)` | Código muerto, no asimetría explotable: esas facturas normalizan a `""` y el prefiltro SQL `IN (folios)` nunca las devuelve. |
| Idempotencia de la ingesta de venta / cambio de proveedor activo | Identidad tributaria con `billing_invoices_identity_unique` + `(provider, external_id)` en refs; cartolas con `onConflictDoNothing` y `payloadHash` que reporta sin pisar. FEL y Chipax convergen a la misma fila: cambiar de proveedor no duplica. |
| Preservación de datos internos en `upsertProviderInvoice` | Sólo toca campos de responsabilidad del proveedor: `notes`, `ownerUserId`, `collectionStatus`, `paymentStatus`, `paidAmount` y los vínculos nunca se escriben; `dueDate` con `dueDateSource = "manual"` se respeta; los ítems sólo se reemplazan si la fuente trajo ítems. |
| Aritmética de `lib/services/billing/money.ts` | Exacta: centavos enteros, un solo `Math.round`, techo de `numeric(14,2)` dentro de `MAX_SAFE_INTEGER`, y ninguna comparación `===` de floats en caminos de decisión. Las sumas `::float8` sobre `numeric(14,2)` siguen siendo exactas en el rango CLP real. |
| Doble imputación del mismo movimiento a la misma factura | Impedida por `billing_invoice_payments_invoice_bank_tx_unique`; el reparto entre varias facturas está serializado por `lockBankTransaction` + `assertAllocationFits`, y confirmar y revertir toman el mismo lock. Doble clic en pago manual: cubierto por el `FOR UPDATE` + ventana de 2 minutos. |
| Alcance por faena en facturación | `invoiceScopePredicate`, `canReachInvoice`, `canReachProposal`, `aliasScopePredicate` y los EXISTS de `collections.ts`/`pending.ts` cubren lecturas y escrituras; `listUnlinkedInvoices` devuelve `[]` para roles acotados; la agregación de `listInvoices`/`getBillingSummary` usa el mismo where. Ninguna agregación de dinero se escapa del scope. |
| Autenticación y reintentos de Chipax | Prefijo `JWT` conforme al contrato; token sólo en memoria con margen de 60 s; un único reintento por 401 con `retry401=false` (test cuenta las solicitudes); sólo GET idempotentes; ambas capacidades de escritura en `false` con test que lo fija; `AbortSignal.timeout` en login y en cada GET. |
| `deleteOrderAction` y el cascade a `purchase_order_invoices` | Es soft delete (`deletedAt` + renombre de code), así que el cascade nunca se dispara y no colisiona con la FK `NO ACTION` de `dte_documents`. |
| Política de autorización del endpoint de PDF (`purchasing:view` org-wide) | Decisión explícita y documentada en la ruta: los DTE son org-wide y hoy todos los titulares de `purchasing:view` son roles globales; los ids son nanoid. **Si algún día se otorga `purchasing:view` a un rol de faena, esto pasa a ser filtración.** |
| `parseDteTable` (ventas) distinguiendo período vacío de fallo | Sí lo distingue: exige `tbxTotalDocumentos === 0` o el marcador textual, y si no lanza `PARSE_FAILED`. El problema equivalente existe sólo en la bandeja (ORQ-01). |
| NC de compra «inflando» el total de una OC | Las 61/56 nunca se auto-vinculan (filtro `IN ('33','34')` en los tres matchers) y la ruta manual las rechaza. La brecha real no es de conciliación: las NC de compra **no están modeladas** — `reconcileOrderInvoices` compara el total de la OC contra la suma de facturas sin descontarlas, porque no hay dónde registrarlas. |
| `dryRun` de la sincronización de venta | No escribe modelo ni cursores durables (ambas guardas `!dryRun` presentes) y no inserta fila de corrida, así que no compite con el índice parcial. |

**Menores conocidos, deliberadamente no elevados a hallazgo** (para que tampoco se levanten como bugs): `client.ts:253` tiene una condición `|| url.endsWith(".xml")` inalcanzable porque `buildUrl` siempre agrega el query string — bórrala para que nadie confíe en ella. `resumableCursor` escribe el centinela `"1"` cuando no hay cursor real (inofensivo: toda clave empieza con el año). Las claves de cursor en `system_settings` se acumulan por período sin limpieza. `taxRate()` cae a 0.19 y coincide con el `.env`, pero si alguien cambia `TAX_RATE` el total mostrado en el navegador y el guardado en servidor divergen. `checkProviderHealthAction` acepta un `provider` sin validación runtime (conviene un `z.enum` si se agregan proveedores).

## 6. Orden de trabajo sugerido

0. **HOY, y antes de tocar código — rotar los secretos de `doc.env` y sacarlo de git.** Rotar `AUTH_SECRET`, `CRON_SECRET`, `POSTGRES_PASSWORD`, `RESEND_API_KEY` y `COPEC_PASSWORD`; `git rm --cached doc.env` + `.gitignore`; purgar el blob del historial si el repositorio salió alguna vez de tu control; y ampliar el filtro de `scripts/check-env-files.ts:17` para que cualquier `*.env` rastreado rompa CI. **SEC-01.** Va antes que todo lo demás porque la rotación es lo único que la remoción no consigue sola, y porque mientras `CRON_SECRET` siga publicado, cualquiera dispara las dos integraciones a voluntad. Ojo: quitar el archivo sin rotar no resuelve nada.

1. **Signo de NC en un único punto compartido** — `lib/services/billing/invoices.ts` (`upsertProviderInvoice`), exportando `asCredit` desde `dte-xml.ts`. Cubre **CHX-01** para Chipax y FEL a la vez; parchar sólo `mapDte` deja el mismo error entrando por el otro proveedor. Va primero porque es dinero mal escrito hoy, en ambas vías, y duplica la cuenta por cobrar de cada NC.
2. **Filtro de signo en la conciliación bancaria y en `derivePaymentStatus`** — `lib/services/billing/reconciliation.ts:114,250-263` y `lib/services/billing/invoices.ts:492-511`. **MON-02** y **MON-01** son el mismo error conceptual (comparar magnitudes sin signo) y se arreglan en la misma pasada, con dos tests: movimiento negativo contra factura positiva, y `derivePaymentStatus(1190000, [-1190000]) → 'unpaid'`. Segundo porque MON-02 puede dar por cobrada una factura viva con un clic de cobranza y el panel no muestra el dato que delataría el error.
3. **Cartolas de dos períodos** — `app/api/cron/chipax-sync/route.ts:58`: mover la llamada dentro del `for (const period of periods)`. **CHX-02**, una línea, más actualizar `route.test.ts:83` que asserta el alcance actual. Va aquí porque pierde plata una vez al mes sin recuperación automática.
4. **Recalcular estado de pago al cambiar el total** — `lib/services/billing/invoices.ts:345`, `recomputeInvoicePaymentStatus(tx, existing.id)` cuando `changedFields` incluya `totalAmount`. **MON-04**, una línea, cierra el último defecto de dinero activo.
5. **Desatascar el vínculo DTE↔OC** — relajar la guarda de estado de `deletePurchaseOrderInvoice` (`lib/services/purchasing-module/invoices.ts:424`) y filtrar la orden en `matchToPurchaseOrderInvoices` (`reconciliation.ts:186`, `status <> 'cancelled' AND deleted_at IS NULL`). **REC-01** y **REC-02** se tocan juntos: uno crea el estado atrapado y el otro lo produce automáticamente.
6. **Guarda de fecha y monto en el auto-match** — `reconciliation.ts:316` y `:241`, aplicando el piso `fechaEmision >= order.createdAt` que ya usan `validateDteForInvoiceTx` y `selectDteCandidates`, y dejando como candidato (no como vínculo) lo que exceda la tolerancia. **REC-04**, mismo archivo que el punto anterior.
7. **Blindar el lado combustible** — `linkDteToFuelLoad` espejo del lado OC + migración `uniqueIndex("dte_documents_fuel_load_single_unique")` (**REC-03**), guardas en `updateFuelLoadAction`/`deleteFuelLoadAction` y `safeActionMessage` (**REC-07**), y extender `scripts/preflight-dte-single-link.ts` con la consulta de duplicados por `fuel_load_id` **antes** de la migración. Un solo bloque: comparten archivo y el preflight es prerrequisito del índice.
8. **Respaldo del keyring, en la misma pasada que el keyring** — añadir a `ENV_WHITELIST` (`scripts/backup-orchestrator.sh:187`) las variables `DTE_*`, `BILLING_*` y `CHIPAX_*` que el compose inyecta, con una prueba que falle si el compose gana una variable que el respaldo no guarda (**BKP-01**); y cifrar el snapshot antes de subirlo, sacando `rclone.conf` y `gdrive-service-account.json` del tar que viaja al destino que ellos protegen (**BKP-02**). Va pegado al punto del keyring porque son la misma decisión operativa: si vas a cortar a `encrypted_only`, el respaldo de la llave es prerrequisito, no seguimiento. Hoy un restore catastrófico deja las dos integraciones muertas sin vuelta.

9. **Keyring** — incluir las filas de Chipax en `rotateDteSettingsKeyring` (`settings.ts:584`, **CRED-01**) y hacer que `applySensitive` lance `DTE_SETTINGS_KEYRING_REQUIRED` en vez de escribir en claro (`settings.ts:336`, **CRED-02**), más `canStoreSecrets` en el DTO de Admin. Se agrupan porque son el mismo módulo y el mismo runbook; van después de lo monetario porque exigen una decisión operativa (el corte a `encrypted_only`), no sólo código.
10. **Honestidad del contador de completitud** — `DteBandejaResult.declaredTotal: number | null` propagado a `sync.ts` para reportar `partial` cuando no se pueda verificar (**ORQ-01**), y en la misma pasada endurecer el parser: `parseMonto` estricto con decodificación de entidades (**PAR-01**), validación de calendario en `parseFechaPortal` (**PAR-08**), strip de comentarios en `splitTopLevelTdCells` con reindexado (**PAR-06**) y el cap de `MAX_DTE_HTML_BYTES` en `fetchWithTimeout` (**PAR-02**). Todo en `parser.ts`/`bandeja-entrada.ts`/`client.ts`: una sola pasada de endurecimiento con su tanda de tests. Cuidado de no regresar el caso `tbxTotalRegistros=0` con período legítimamente vacío, que está cubierto por prueba.
11. **`cleanRut` en la ingesta** — `bandeja-entrada.ts:157` y el mismo valor canónico en `dte-download-xml.ts:70`. **PAR-05**, una línea cada uno; backfill sólo si aparecen filas con puntos.
12. **Separar la señal de la alerta** — sacar `unmatched` de `withIssues` en `sync.ts:251` y usar códigos distintos para ingesta-parcial y conciliación-pendiente (**REC-06**), y exponer `dteSyncRuns.error` en `/admin/dte` conservando la redacción (**ORQ-02**). Van juntos: uno apaga el ruido diario, el otro hace legible la alerta que quede. Sin esto, todo lo anterior se detecta tarde.
13. **Reportes que mienten** — `requireDteCodEmp()` compartido para los tres exports y `/compras/dte` (**API-04**), filtro `vinculo` en el WHERE con `limit: 301` y aviso de recorte (**API-02**), derivación marcada de Neto/IVA en el Libro de Compras (**CMP-05**, distinguiendo lo leído del XML de lo derivado y sin aplicar 1.19 a exentas ni a combustible con IEC), y deduplicación por factura en `queries.ts:647-680` (**MON-03**).
14. **Auditoría del export de cobranza** — `app/api/reportes/export/route.ts:33`: exigir ambos permisos con `can` y copiar el bloque de `recordAudit` de la ruta gemela. **API-03**, quince minutos, y es lo único que el manifiesto promete y no cumple para todos los usuarios.
15. **Decisión de modelo para combustible** — tabla de unión N:1 o, mínimo lazy, distinguir en `summarizeDteReconciliation` la ambigüedad del lado interno de «sin vínculo» (**CMP-06**). Va aquí porque es diseño, no parche, y su síntoma inmediato (ruido en la corrida) ya lo tapa el punto de «Separar la señal de la alerta».
16. **Limpieza y diagnóstico** — borrar `computeHealthStats` y su nota de `finance-section.tsx` (**REC-08**) y `prefillInvoiceFromDte` con su test (**CMP-08**); propagar los mensajes de las clases propias en `redact()` (**VTA-05**); comparar identidad en `enrichFromXml` (**VTA-02**); manejar `(invoiceId, provider)` en `upsertExternalRef` (**VTA-04**); `try/catch` alrededor de `response.json()` en Chipax (**CHX-07**); `reportedTotal` en `syncBankTransactions` (mitad barata de **CHX-04**); piso de backoff en el 429 (**CHX-06**); techo desacoplado en `DTE_PAGE_SIZE` (**CHX-08**); 400 en vez de 500 para período inválido (**ORQ-06**); `correlationId` y período en los warns de fila descartada (**ORQ-03**); fencing en el cierre de corrida (**ORQ-04**); orden de ramas en `cronContractFor` (**ORQ-05**); `catch` en las dos lecturas de `readDtePortalConfig` del dashboard (**API-01**) y permiso en el tile de NC (**API-06**). Todos son diffs de una a cinco líneas sin riesgo de regresión; agrúpalos en uno o dos commits.
17. **Endurecimiento diferido, sin urgencia** — semáforo real en `withDtePortalOperationLease` (**API-08**), paginación defensiva de `/dtes` y cartolas (**CHX-03**, mitad restante de **CHX-04**), parseo fila-a-fila tolerante en Chipax (**CHX-05**), clave de agrupación normalizada en duplicados (**MON-05**), bucket propio para `overpaid` (**MON-06**), signo en los ítems de NC (**VTA-06**), moneda leída del XML (**VTA-07**), rescate del cursor de ventas con candidatos por debajo (**VTA-03**), verificación de identidad antes de persistir el XML (**CMP-01**), persistencia del resultado negativo del lookup de PDF (**CMP-07**), mapa `codEmp → carpeta` o rechazo por `codEmp` distinto (**CMP-09**), `recordAudit` dentro del `tx` en las seis rutas de credenciales (**CRED-04**), fallo duro de `openSecret` ante sobre ilegible (**CRED-03**), saneado de `extractPdfPostUrl` a sólo `post` (**PAR-07**), ambigüedad 33/34 fuera del período (**REC-05**). Ninguno pierde datos hoy; todos son baratos cuando el archivo esté abierto por otra razón.

---

## 7. Cómo se produjo esta auditoría

20 agentes: 9 auditores en paralelo sobre dimensiones disjuntas (scraping/parseo, orquestación y concurrencia, conciliación, credenciales y cripto, provider Chipax, motor de venta, dinero/duplicados, puntos de contacto Compras/Combustibles, superficie API/RBAC/reportes), cada uno con un verificador adversarial cuyo trabajo era **refutar**, más un crítico de completitud que buscó lo que ninguna dimensión miró y un redactor.

64 hallazgos brutos de las 9 dimensiones → 2 refutados por completo y el resto consolidados por identidad (varias dimensiones encontraron el mismo defecto por caminos distintos), más 9 del crítico de completitud. **El documento reporta 65: 1 CRITICAL, 5 P1, 23 P2 y 36 P3.** La verificación además degradó severidades (`PAR-01` y `PAR-02` bajaron de P1/P2 a P3 al comprobar que el formato real del portal no dispara el fallo). Los que quedan como `PLAUSIBLE` en vez de `CONFIRMED` son los que dependen de que el portal o Chipax cambien algo — endurecimiento, no corrupción en curso.

Verificado a mano por encima del trabajo de los agentes: los tres P1 de dinero contra el código; el rastreo de `doc.env` en git y el hueco del filtro de `check-env-files.ts`; la whitelist del orquestador de respaldos; que `estadoSii: null` es la única escritura; y que la superficie completa está en verde — `npx vitest run` sobre `lib/services/billing`, `lib/services/dte-portal`, los cuatro crons, `app/api/dte-portal` y las acciones DTE de Compras: **36 archivos, 426 pruebas, todas pasando**. Ninguno de los hallazgos es una regresión: son huecos que las pruebas actuales no cubren.

---

## 8. Remediación — 2026-08-20

Tres tandas, 91 fixes, más cinco bugs que aparecieron al abrir el código.

### Los tres defectos de dinero

| | Arreglo |
|---|---|
| **CHX-01** | `applyCreditSign` en `lib/services/billing/dte-xml.ts`, aplicada **en un solo punto** — `upsertProviderInvoice` — de modo que cubre Chipax y FacturaEnLínea a la vez. Es `-Math.abs(v)`, **idempotente**: crítico, porque el libro de ventas del portal ya entrega las NC en negativo (`parser.test.ts:46-47`) y con `v * -1` se habrían invertido dos veces. |
| **MON-02** | Guardia de signo en `proposeMatches`, la función compartida, en vez del filtro SQL que proponía el informe: ese filtro habría excluido los movimientos negativos que **sí** corresponden a una NC de venta, justo el caso a proteger. |
| **CHX-02** | `syncBankTransactions` movida dentro del bucle de períodos que ya existía para ventas. |

### Lo que cambió de forma no obvia

- **Autosanante, sin backfill.** `computePayloadHash` se calcula ahora sobre el payload ya normalizado, así que la primera corrida tras el despliegue corrige sola las NC guardadas en positivo. Cada una generará un `invoice.updated_from_provider`; es esperado.
- **Van a aparecer corridas `partial` que antes cerraban `success`.** Es el punto de los fixes de completitud (ORQ-01, CHX-04), no una regresión: una corrida cuya completitud nadie pudo verificar no tiene éxito que reportar.
- **La huella de las alertas de salud cambió**, así que la primera evaluación degradada tras el despliegue avisa una vez de más. Se estabiliza en la corrida siguiente; no amerita migración.
- **El cifrado del respaldo es opt-in** (`BACKUP_ENCRYPTION_PASSPHRASE`) y **exige recrear los contenedores** para entrar. Hasta entonces el respaldo sigue subiendo en claro y el orquestador lo advierte en su log.

### Lo que encontró la remediación y la auditoría no

Abrir el código destapó cinco defectos que ninguna dimensión había visto, todos en el camino de respaldos: `backup-verify.sh` emitía JSON contaminado que la UI nunca podía leer, moría en silencio con exit 1 y sin informe, usaba una función `warn()` indefinida, y tras un restore el servidor nuevo volvía a respaldar sin cifrar.

Y el patrón que más se repitió: **el mismo defecto arreglado en un llamador y vivo en el otro.** `declaredTotal` se tapó en el sync de compras y siguió abierto en el de ventas; el cifrado se enseñó a `catastrophic-restore.sh` y no a `restore-all.sh`; la passphrase llegaba al respaldo programado y no al manual. Cada uno exigió una pasada extra. Es el argumento a favor de arreglar en la raíz y no donde el síntoma se reportó.

### Cobertura

Cada fix no trivial dejó una prueba que falla sin él. Dos merecen mención porque protegen invariantes que ya se habían roto una vez: `scripts/backup-env-whitelist.test.ts` falla si el compose gana una variable que el respaldo no guardaría —mantener esa lista a mano fue exactamente lo que produjo BKP-01—, y `scripts/backup-encryption.test.ts` exige que la passphrase llegue a **los dos** servicios que respaldan.
