# Auditoría de bugs, errores e inconsistencias — 2026-08-05

## Resumen ejecutivo

Auditoría estática sobre `main` (último commit `bdcd948`, árbol de trabajo sucio
por edición concurrente de UI). Es la **segunda pasada** de este tipo: la de
`AUDITORIA_BUGS_2026-07-28.md` cerró 34 hallazgos en 46 pasadas, así que ésta se
concentró en lo que aún no había sido auditado —el código incorporado entre el
2026-07-31 y hoy— más una verificación de regresión de los controles que aquel
informe declaró sanos.

Superficie nueva revisada: **Facturación y Cobranza** (`lib/services/billing/**`,
`app/(app)/facturacion/**`, proveedor Chipax, motor de conciliación bancaria),
**portal DTE FacturaEnLínea** (`lib/services/dte-portal/**`), **inspecciones SST
/ PDTP** (`lib/sst/definitions/**`, `lib/prevention/inspections.ts`,
`lib/services/pdtp/compliance.ts`) y los gates de CI.

| Severidad | Cantidad | Criterio aplicado |
|---|---:|---|
| P0 | 0 | No se encontró bypass de alcance explotable sin conocer un ID opaco |
| P1 | 6 | Integridad de dinero, función principal inoperante o gate de calidad caído |
| P2 | 7 | Edge case relevante, inconsistencia con efecto acotado |
| P3 | 4 | Endurecimiento y deuda de consistencia |
| **Total** | **17** | Hallazgos con evidencia concreta |

> **Estado al 2026-08-05, tras dos rondas de remediación: los 17 hallazgos
> están cerrados con evidencia verificable.** El dictamen de abajo describe el
> hallazgo original; el registro de remediación al final documenta cada fix,
> su prueba y su verificación.

### Dictamen

**No-GO para operar Facturación y Cobranza con dinero real** hasta corregir
H-01 y H-02: los dos permiten que la plataforma declare cobrado algo que no lo
está. El resto de la plataforma no cambia su estado respecto del informe
anterior.

Además, **el pipeline de CI está rojo hoy** (H-06) y **53 suites de regresión no
se ejecutan en ningún gate** (H-05) — incluidas exactamente las que el informe de
julio creó como evidencia de sus correcciones P0/P1. Al ejecutarlas por primera
vez en esta auditoría, **una salió roja** (H-17): la prueba llevaba fallando sin
que nadie lo supiera, que es justamente lo que H-05 predice.

### Prioridad de remediación

1. **H-01, H-02** — dinero. Bloquear la fila del movimiento bancario al confirmar
   y recalcular el estado de pago tras fusionar duplicados.
2. **H-06** — desbloquear el gate de seguridad (advisory nuevo fuera del
   allowlist). Sin esto ningún otro fix llega a `main` con CI verde.
3. **H-03** — la sincronización DTE de compras hoy importa una sola vez al mes.
4. **H-05 + H-17** — arreglar el test roto y luego incorporar `test:pglite` al CI,
   antes de tocar cualquiera de los servicios que esas suites cubren.
5. **H-04** — decidir el contrato de puntaje de inspecciones antes de que se
   acumule más historia con dos escalas mezcladas.

---

## Alcance y método

- Fuentes auditadas: `lib/services/billing/**`, `lib/services/dte-portal/**`,
  `app/(app)/facturacion/**`, `app/(app)/admin/dte/**`, `app/api/cron/**`,
  `db/schema/billing.ts`, `db/schema/dte.ts`, `lib/prevention/inspections.ts`,
  `lib/sst/**`, `lib/services/pdtp/compliance.ts`, `lib/auth/**`,
  `.github/workflows/ci.yml`, `vitest.config.ts`.
- Barrido de regresión de los patrones transversales del informe anterior
  (§10–§13 del prompt): `sonner`, exports CSV, `redirect()` en `try`, `db.*`
  sin `await`, `notifyAfterCommit`, invalidación de caché RBAC.
- Se ejecutaron los comandos de verificación de §15 (resultados más abajo).
- **No se modificó código.** El único archivo agregado por esta auditoría es
  este informe. `AUDITORIA_BUGS_2026-07-28.md` se dejó intacto: es el registro
  de remediación de la pasada anterior, no un archivo a sobrescribir.
- Limitación declarada: no se levantó la aplicación ni se reprodujo ningún
  hallazgo contra una base de datos. Las reproducciones descritas son
  derivaciones del código y del esquema, no ejecuciones observadas.

---

## Hallazgos P1

### H-01 — Un mismo movimiento bancario puede pagar dos facturas completas

**Severidad: P1** · `[BUG]`

`app/(app)/facturacion/cobranza/actions.ts:319-327`;
`lib/services/billing/reconciliation.ts:346-365,371-382`

**Qué falla.** `resolvePaymentSuggestionAction` valida el saldo disponible del
movimiento leyéndolo con `tx.query.billingBankTransactions.findFirst(...)`, es
decir **sin `FOR UPDATE`**. Con el aislamiento por defecto (READ COMMITTED), dos
transacciones concurrentes leen el mismo `allocatedAmount`, las dos superan
`assertAllocationFits` y las dos confirman. Después,
`recomputeTransactionAllocation` escribe el total que cada una calculó *antes* de
tomar el lock de escritura, así que el último en commitear pisa al otro.

**Cómo reproducir.** Un movimiento de $1.000.000 que `generatePaymentSuggestions`
propuso contra dos facturas distintas (el motor propone el monto disponible
completo a cada factura candidata, `reconciliation.ts:156-158`). Dos operadores
—o un doble clic sobre dos filas de la lista de sugerencias— confirman ambas al
mismo tiempo. Resultado: dos facturas quedan `paid`, `billing_invoice_payments`
tiene $2.000.000 confirmados contra un movimiento de $1.000.000, y
`billing_bank_transactions.allocated_amount` queda en $1.000.000 (el valor del
perdedor de la carrera), ocultando el sobregiro.

**Impacto.** Cuentas por cobrar declaradas cobradas sin respaldo bancario. El
control que el módulo documenta como su garantía central ("un movimiento
repartido entre varias facturas es válido, sobregirarlo no") no se sostiene bajo
concurrencia. Es dinero, y el error es silencioso.

**Fix sugerido.** Bloquear la fila del movimiento dentro de la transacción antes
de validar, y verificar la transición de la sugerencia con `WHERE ... status =
'suggested'` comprobando `returning()`:

```ts
const snapshot = await db.transaction(async (tx) => {
  if (payment.bankTransactionId) {
    const [transaction] = await tx
      .select({ id: billingBankTransactions.id, amount: billingBankTransactions.amount,
                allocatedAmount: billingBankTransactions.allocatedAmount })
      .from(billingBankTransactions)
      .where(eq(billingBankTransactions.id, payment.bankTransactionId))
      .for("update")                                   // ← serializa a los confirmadores
    if (!transaction) throw new Error("El movimiento bancario ya no existe")
    assertAllocationFits(transaction.amount, transaction.allocatedAmount, finalAmount)
  }

  const [updated] = await tx.update(billingInvoicePayments)
    .set({ verificationStatus: "confirmed", amount: finalAmount, confirmedBy: session.user.id, confirmedAt: now, updatedAt: now })
    .where(and(
      eq(billingInvoicePayments.id, paymentId),
      eq(billingInvoicePayments.verificationStatus, "suggested"),   // ← no reconfirma
    ))
    .returning({ id: billingInvoicePayments.id })
  if (!updated) throw new Error("La sugerencia ya fue resuelta por otra persona")
  // …
})
```

`revertPaymentAction` necesita el mismo lock, por la misma razón.

---

### H-02 — Fusionar duplicados mueve los pagos pero no recalcula el saldo

**Severidad: P1** · `[BUG]`

`lib/services/billing/duplicates.ts:331-333,347-351`

**Qué falla.** `mergeDuplicate` traslada las filas de `billing_invoice_payments`
de la factura descartada a la superviviente, pero **nunca llama a
`recomputeInvoicePaymentStatus`** para ninguna de las dos. `paidAmount` y
`paymentStatus` son caché derivada declarada explícitamente en el esquema
(`db/schema/billing.ts:82-88`), y quedan desincronizadas de sus pagos.

**Cómo reproducir.** Dos facturas del mismo cobro: A (superviviente, sin pagos) y
B (descartada, con un pago confirmado de $500.000 — la combinación que la propia
guarda de `duplicates.ts:301-305` permite, porque solo rechaza cuando **ambas**
tienen pagos). Fusionar quedándose con A. Resultado: A pasa a ser dueña del pago
confirmado pero conserva `paid_amount = 0` y `payment_status = 'unpaid'`.

**Impacto.**
1. La factura aparece impaga en Cobranza y en el aging pese a estar pagada:
   se vuelve a gestionar y se puede cobrar dos veces.
2. `generatePaymentSuggestions` la sigue considerando abierta
   (`reconciliation.ts:242-247` filtra `paymentStatus <> 'paid'`), así que el
   motor puede proponer un segundo movimiento contra ella.
3. B queda anulada con un `paid_amount` que ya no respalda ningún pago.

**Fix sugerido.** Recalcular ambas dentro de la misma transacción, después de
mover los pagos:

```ts
await tx.update(billingInvoicePayments)
  .set({ invoiceId: input.keepId })
  .where(eq(billingInvoicePayments.invoiceId, input.dropId))

// La caché de saldo es derivada: si se movieron los pagos, hay que rederivarla.
await recomputeInvoicePaymentStatus(tx, input.keepId)
await recomputeInvoicePaymentStatus(tx, input.dropId)
```

Nota adicional del mismo bloque: si A y B tienen cada una un pago proveniente del
**mismo** movimiento bancario, el traslado viola
`billing_invoice_payments_invoice_bank_tx_unique` y la fusión aborta con un error
crudo de Postgres. Conviene detectarlo antes y devolver un `DuplicateMergeError`
legible.

---

### H-03 — La sincronización DTE de compras importa una sola vez al mes

**Severidad: P1** · `[BUG]`

`lib/services/dte-portal/sync.ts:81-102`;
`app/api/cron/dte-portal-sync/route.ts:31`;
`app/(app)/admin/dte/actions.ts:28`;
`app/(app)/admin/dte/dte-sync-actions.tsx:9-51`

**Qué falla.** `syncDteDocuments` corta la corrida con `status: "skipped"` si ya
existe **cualquier** corrida `success` para ese `(periodo, codEmp)`, salvo que se
pase `force: true`. Ni el cron ni el botón de administración lo pasan nunca, y la
UI no ofrece la opción.

**Cómo reproducir.** Día 1 del mes: el cron corre y termina `success`. Día 2 en
adelante: cada ejecución del cron entra en `sync.ts:90`, devuelve `skipped` y no
consulta el portal. Los DTE que los proveedores envían el resto del mes no
ingresan. En Administración › Sincronización DTE el botón responde *"Ya existe
una corrida exitosa para este período. No se sincronizó de nuevo."* y no hay
forma de forzar desde la interfaz. La única vía es `POST /api/dte-portal/sync`
con `{"force": true}` a mano.

**Impacto.** El libro de compras DTE queda con la foto del primer día del mes.
Todo lo que se apoya en él —conciliación contra OC (`matchToPurchaseOrderInvoices`),
contra cargas de combustible, notas de crédito pendientes y los indicadores del
dashboard— trabaja sobre datos incompletos sin señal de que lo estén.

**Fix sugerido.** El período en curso siempre se re-consulta; el corte por
"ya sincronizado" sólo tiene sentido para períodos cerrados:

```ts
// Sólo un período ya cerrado puede darse por sincronizado: el mes en curso
// sigue recibiendo documentos hasta que termina.
const periodoCerrado = periodo < currentPeriodo()
if (!options.force && periodoCerrado) {
  const priorSuccess = await db.query.dteSyncRuns.findFirst({ /* … */ })
  if (priorSuccess) return { /* skipped */ }
}
```

Y exponer un "forzar re-sincronización" en `dte-sync-actions.tsx` para los
períodos cerrados.

---

### H-04 — Dos motores puntúan el mismo catálogo con escalas distintas, y el PDTP promedia ambas

**Severidad: P1** · `[INCONSISTENCIA]`

`lib/services/prevention-inspections.ts:33,114-129`;
`lib/prevention/inspections.ts:140-165`;
`lib/sst/compliance.ts:48-77`;
`lib/services/pdtp/compliance.ts:371-378`;
`db/schema/prevention/inspections.ts:131`

**Qué falla.** El catálogo `lib/sst/definitions/**` declara ítems con escala
B/R/M nativa (`kind: 'bueno_regular_malo_obs'`,
`'bueno_regular_malo_na_obs'`, `'bueno_regular_malo_na_nt_obs'`) — Anexo 13
carros, Anexo 14, inspección de EPP, entre otros. Ese mismo catálogo alimenta
**dos** motores incompatibles:

| | Motor SST (`lib/sst/compliance.ts`) | Motor transversal (`lib/prevention/inspections.ts`) |
|---|---|---|
| Estados | `cumple` · `regular` · `no_cumple` · `na` · `no_tiene` | `conforming` · `non_conforming` · `not_applicable` |
| "Regular" | cuenta 0,5 en el numerador (`PARTIAL_STATUS_WEIGHT`) | **no existe** |
| Restricción | — | `check` de BD: `result IN ('conforming','non_conforming','not_applicable')` |

`itemsFromDefinition` (`prevention-inspections.ts:114-129`) aplana la definición
y **descarta `item.kind`**: la información de que el ítem es B/R/M se pierde
antes de llegar al motor, y la UI (`inspection-run-detail.tsx:83`) sólo ofrece
tres opciones.

Y `computeVerificacionYCierre` promedia las dos escalas en una sola cifra:

```ts
const validPct = [
  ...instances.map((instance) => instance.porcentajeCumplimiento),  // escala con 0,5
  ...inspectionRows.map((row) => row.compliancePercent),            // escala binaria
].filter((pct): pct is number => pct !== null)
```

**Cómo reproducir.** Un Anexo 13 con 10 ítems, 8 buenos y 2 regulares. Ejecutado
por el motor SST: `(8 + 2×0,5)/10 = 90 %`. Ejecutado por el motor transversal: el
evaluador no tiene "Regular" y debe elegir *Cumple* (→ 100 %) o *No cumple*
(→ 80 %). El eje "verificación" del índice integral PDTP promedia 90 % con 100 %
o con 80 % como si fueran la misma medida.

**Impacto.** El indicador de cumplimiento del programa preventivo no es
comparable entre faenas ni entre períodos: depende de por qué motor pasó la
inspección. Es el número que se presenta a gerencia y a fiscalización.

**Fix sugerido.** Decidir un contrato único. La opción de menor diff es propagar
el `kind` y hacer que el motor transversal entienda el estado intermedio,
reutilizando la constante que ya existe:

```ts
// prevention-inspections.ts — no descartar la escala del ítem
items.push({ /* … */, kind: item.kind })

// lib/prevention/inspections.ts — un tercer resultado con el mismo peso que SST
result: "conforming" | "partial" | "non_conforming" | "not_applicable"
scoredConforming += answer.result === "conforming" ? 1
                  : answer.result === "partial"    ? PARTIAL_STATUS_WEIGHT : 0
```

Requiere migración del `check` de `prevention_inspection_answers` y una decisión
sobre las respuestas ya capturadas. Mientras no se resuelva, `verificacion`
debería informar por separado ambas fuentes en vez de promediarlas.

---

### H-05 — 53 suites de regresión no se ejecutan en ningún gate

**Severidad: P1** · `[GAP]`

`tests/pglite-files.ts:11-64`; `vitest.config.ts:18`;
`.github/workflows/ci.yml:105,129,139,176`; `package.json` (`test`, `test:coverage`)

**Qué falla.** `vitest.config.ts` excluye `pgliteTestFiles` del proyecto por
defecto, así que `npm test` y `npm run test:coverage` no los corren. El CI
ejecuta `test:coverage` y luego tres pasos extra con globs
`*concurrency-postgres.test.ts`, `*scope-postgres.test.ts` y
`prevention-*-postgres.test.ts`. **Ninguno de los 53 archivos PGlite coincide con
esos globs**, y `npm run test:pglite` no aparece en el workflow.

**Cómo reproducir.** `grep -n "pglite" .github/workflows/ci.yml` → sin
resultados. Entre los archivos huérfanos están precisamente los que el informe de
julio construyó como evidencia de cierre:
`lib/__tests__/purchasing-service.test.ts` (P0-01, P1-05, P1-15),
`lib/__tests__/receiving-two-stage.test.ts` (P0-02, P1-06),
`lib/__tests__/item-state-mutations.test.ts` (P1-03, P2-24),
`lib/__tests__/physical-inventory-service.test.ts` (P1-07/08),
`lib/__tests__/stock-service.test.ts` (P1-09),
`lib/__tests__/epp-replenishment.test.ts` (P1-13),
`lib/__tests__/full-flow-integration.test.ts` (P1-12),
`lib/__tests__/requests-delete.test.ts` (P1-21),
más las cuatro suites de integración del módulo nuevo de facturación
(`sync-integration`, `queries-scope`, `payments-integration`,
`duplicates-integration`).

**Impacto.** Una regresión sobre cualquiera de los P0/P1 cerrados en julio entra
a `main` con el CI en verde. El hallazgo P1-23 del informe anterior se cerró para
las suites `*-postgres.test.ts`, pero la familia PGlite —que creció desde
entonces— quedó fuera del mismo razonamiento.

**Confirmado en esta pasada.** Se ejecutó `npm run test:pglite` (724 s):
**1 archivo fallido / 52 verdes, 1 test fallido / 483 verdes**. El fallo
(H-17) es reproducible en aislamiento y estaba en `main` sin que ningún gate lo
señalara. No es un riesgo teórico: la suite ya está roja.

**Fix sugerido.** Un paso obligatorio más en `ci.yml`, después de las pruebas
unitarias:

```yaml
      - name: Integration tests (PGlite, serial)
        run: npm run test:pglite
```

y una prueba de contrato que falle si un archivo que importa `@electric-sql/pglite`
no está listado en `tests/pglite-files.ts` — hoy ese registro se mantiene a mano
(lo dice su propio comentario) y olvidarlo saca un test del gate en silencio.

---

### H-06 — El gate de seguridad está caído: advisory nuevo fuera del allowlist

**Severidad: P1** · `[GAP]`

`scripts/check-security-audit.ts:13,26`; `.github/workflows/ci.yml:81`

**Qué falla.** `npm run check:security-audit` termina en error:

```
npm audit encontró hallazgos altos/críticos fuera del allowlist documentado:
- brace-expansion (<=1.1.17 || 2.0.0 - 2.1.3 || 4.0.0 - 5.0.8) -> GHSA-rgw5-rvv9-x895
```

El allowlist cubre `GHSA-mh99-v99m-4gvg` (brace-expansion, DoS por expansión sin
límite) y `GHSA-f88m-g3jw-g9cj` (sharp/libvips). El advisory
`GHSA-rgw5-rvv9-x895` —*"DoS via unbounded intermediate arrays, bypassing the
CVE-2026-14257 mitigation"*, mismo paquete, mismas tres rutas: raíz,
`minimatch/`, `readdir-glob/`— es posterior a la redacción del allowlist.

**Impacto.** El paso 81 del CI falla en cada push, y ese paso reemplazó a los dos
`npm audit --audit-level=high` previos: es el único gate de dependencias. Con el
pipeline rojo de base, un fallo real se vuelve indistinguible del ruido y el
equipo se acostumbra a ignorarlo.

**Fix sugerido.** Rehacer el análisis de alcanzabilidad que ya está documentado
para `GHSA-mh99-v99m-4gvg` —es el mismo paquete y el mismo camino
(`archiver → readdir-glob`, sólo alcanzable desde el `WorkbookWriter` de
streaming de ExcelJS, que esta aplicación no usa)— y, si se confirma, extender la
entrada del allowlist a ambos GHSA con su justificación y fecha de re-revisión.
Si el análisis no se sostiene, subir `brace-expansion` por `overrides`.

---

## Hallazgos P2

### H-07 — Una corrida de cartolas colgada bloquea ese período para siempre

**Severidad: P2** · `[BUG]`

`lib/services/billing/sync.ts:105,285-295,375-390`; `db/schema/billing.ts:523-525`

**Qué falla.** `markStaleRunsAsFailed` sólo se invoca desde
`syncBillingInvoices` (línea 105). `syncBankTransactions` inserta su corrida
`running` **sin limpiar antes las corridas colgadas** de su propio alcance. Como
el índice `billing_sync_runs_single_active_unique` es parcial sobre
`status = 'running'`, una corrida de cartolas cuyo proceso murió a mitad de
camino deja una fila `running` que nunca caduca.

**Cómo reproducir.** Disparar la sincronización de movimientos bancarios y matar
el proceso (deploy, OOM, timeout de plataforma). Todo intento posterior para ese
`(provider, 'bank_transactions', período)` choca contra el índice único, cae en
el `catch` de la línea 293 y devuelve *"Ya hay una sincronización en curso para
este período."* — indefinidamente.

**Impacto.** La conciliación bancaria de ese mes queda sin insumo y el mensaje
apunta a una causa falsa. Sólo se destraba editando la base a mano.

**Fix sugerido.** Una línea, simétrica con el otro camino:

```ts
await markStaleRunsAsFailed(options.provider, "bank_transactions")

const runId = nanoid()
try { await db.insert(billingSyncRuns).values({ /* … */ }) }
```

---

### H-08 — Las acciones de escritura de facturación no revalidan el alcance del registro existente

**Severidad: P2** · `[INCONSISTENCIA]`

`app/(app)/facturacion/actions.ts:168-186,263-272,371-386`;
`app/(app)/facturacion/propuestas/actions.ts:76-80,103-108`;
comparar con `app/(app)/facturacion/cobranza/actions.ts:496-515`

**Qué falla.** Cobranza define `canReachInvoice` y lo aplica en las cuatro
acciones que tocan una factura. El resto del módulo no lo usa:

| Acción | Verifica el alcance del registro que modifica |
|---|---|
| `recordCollectionActionAction`, `registerManualPaymentAction`, `resolvePaymentSuggestionAction`, `revertPaymentAction` | **Sí** (`canReachInvoice`) |
| `updateInvoiceInternalDataAction` | No |
| `linkInvoiceAction` | Sólo la faena *destino*, no la factura |
| `rejectInvoiceLinkAction` | No, ninguna |
| `confirmInvoiceLinkAction` | Sólo si el vínculo ya tiene faena |
| `saveProposalAction` (rama de edición) | Sólo la faena *nueva*, no la propuesta existente |

**Cómo reproducir.** Un usuario acotado a la faena Norte con
`billing:manage_invoices` invoca `linkInvoiceAction({ invoiceId: <id de una
factura de la faena Sur>, worksiteId: <su faena Norte> })`. El vínculo nace
`confirmed` (línea 221) y desde ese momento `invoiceScopePredicate`
(`queries.ts:104-111`) y `canReachInvoice` le abren la factura: el vínculo que
debía *reflejar* el permiso pasa a *otorgarlo*. Lo mismo con
`saveProposalAction`, que puede mover una propuesta ajena a la faena propia.

**Impacto.** Escalación de alcance dentro del módulo financiero. **Atenuante
real:** los IDs son `nanoid()` opacos y las consultas de lectura sí filtran por
alcance (`listUnlinkedInvoices` devuelve `[]` a un rol acotado, verificado en
`queries-scope.test.ts:280`), así que no hay un camino de enumeración desde la
propia aplicación. Es una defensa en profundidad ausente y una inconsistencia
dentro del mismo módulo, no un bypass explotable con lo que la UI entrega.

**Fix sugerido.** Promover `canReachInvoice` a `lib/services/billing/queries.ts`
y aplicarlo en toda acción que reciba un `invoiceId`/`linkId`/`proposalId`; en
`linkInvoiceAction` exigir además que la factura ya sea alcanzable *antes* de
crear el vínculo que ampliaría el alcance.

---

### H-09 — Cualquier fallo al abrir la corrida se informa como "ya hay una sincronización en curso"

**Severidad: P2** · `[BUG]`

`lib/services/billing/sync.ts:122-129,286-295`

**Qué falla.** El `catch` alrededor del `INSERT` en `billing_sync_runs` es
ciego: asume que la única causa posible es el índice único parcial. Una caída de
la base, un timeout de conexión, un `check` violado o un `triggeredBy` que ya no
existe (FK) producen exactamente el mismo `skipped` con el mismo texto.

**Cómo reproducir.** Detener Postgres y disparar la sincronización manual: la
acción responde `ok: true` con *"Ya hay una sincronización en curso para este
período."* — un éxito aparente sobre un servidor caído.

**Impacto.** Diagnóstico falso en el punto donde más se necesita el verdadero, y
un `ok: true` que oculta un incidente de infraestructura.

**Fix sugerido.** Distinguir la violación de unicidad del resto:

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("billing_sync_runs_single_active_unique")) throw error
  return skipped({ /* …, reason: "Ya hay una sincronización en curso…" */ })
}
```

---

### H-10 — La sincronización DTE no tiene guarda de corrida única

**Severidad: P2** · `[BUG]`

`db/schema/dte.ts:42-44`; `lib/services/dte-portal/sync.ts:81-115,270-278`

**Qué falla.** `dte_sync_runs` sólo tiene índices no únicos
(`periodo`, `status`, `startedAt`). No existe el equivalente al
`billing_sync_runs_single_active_unique` que el módulo de facturación sí definió.
El corte por "ya hay una corrida exitosa" es un *read-check-write* sin lock, y
`upsertDteDocument` (líneas 270-278) también lee antes de insertar sin bloquear.

**Cómo reproducir.** El cron y el botón de administración disparándose a la vez
(o dos administradores). Ambas corridas se registran `running`, ambas raspan el
portal y ambas intentan insertar el mismo documento; la segunda choca contra
`dte_documents_unique_key` y el documento se contabiliza como fallo
(`sync.ts:143-147`), degradando la corrida a `partial` sin que nada esté mal en
los datos.

**Impacto.** Doble scraping del portal (con su costo y su riesgo de bloqueo),
métricas de corrida erróneas y corridas marcadas `partial` por una causa
inexistente. Hoy está enmascarado por H-03, que hace que la segunda corrida
casi siempre salga por `skipped`; al corregir H-03 esta carrera queda expuesta.

**Fix sugerido.** Replicar el patrón del módulo de facturación:

```ts
uniqueIndex("dte_sync_runs_single_active_unique")
  .on(table.codEmp, table.periodo)
  .where(sql`${table.status} = 'running'`),
```

y tratar el conflicto de inserción como "ya hay una corrida en curso", no como
error.

---

### H-11 — El código de propuesta se genera con `count(*)` en vez del secuenciador central

**Severidad: P2** · `[INCONSISTENCIA]`

`lib/services/billing/proposals.ts:151-162`; `lib/code-sequences.ts:25`

**Qué falla.** `nextProposalCode` cuenta las filas del año
(`WHERE code LIKE 'PF-2026-%'`) y suma uno. El repositorio tiene un secuenciador
transaccional —`nextCodeTx(tx, prefix, year)`, respaldado por la tabla
`code_sequences` y por `lib/__tests__/code-sequences.test.ts`— que todos los
demás correlativos usan (`SOL`, `OC`, `REC`, `AJU`, `DEV`).

**Cómo reproducir.** Bajo concurrencia, dos creaciones simultáneas obtienen el
mismo `count` y la segunda choca con `billing_proposals_code_unique` — hoy
manejado con un mensaje amable (`propuestas/actions.ts:196-198`), así que el
efecto está acotado. El caso grave es distinto: si alguna vez se borra
físicamente una fila de `billing_proposals` (limpieza, migración, futura función
de borrado), el contador retrocede y **queda permanentemente colisionando** con
un código ya emitido; no hay forma de crear propuestas nuevas hasta reparar los
datos a mano.

**Impacto.** Fragilidad del correlativo y una excepción no justificada a la
convención de códigos del sistema.

**Fix sugerido.** `const code = await nextCodeTx(tx, "PF", Number(data.servicePeriod.slice(0, 4)))`.

---

### H-12 — Cobertura 41,79 %, y la cifra se calcula excluyendo las suites de integración

**Severidad: P2** · `[GAP]`

Salida de `npm run test:coverage`; `vitest.config.ts:29-45`

**Qué falla.** El umbral configurado (40 % statements / 30 % branches) se cumple,
pero el valor real está bajo el 50 % que este prompt marca como bandera:

```
Statements   : 41.79% ( 9169/21938 )
Branches     : 33.89% ( 6044/17834 )
Functions    : 43.97% ( 1825/4150 )
Lines        : 44.28% ( 8085/18255 )
```

Y el número engaña en las dos direcciones: `include` sólo mira `lib/**` (todo
`app/**`, incluidas las Server Actions, queda fuera del denominador), mientras
que el `exclude` de PGlite deja fuera del numerador el código que sí está
cubierto por las 53 suites de H-05. Servicios completos aparecen en 0 %
(`lib/services/purchasing-module/receiving.ts`, `orders-create`, `orders-edit`,
`orders-status`) cuando en realidad tienen pruebas — sólo que en el proyecto
excluido.

**Impacto.** La cobertura no sirve hoy para decidir dónde falta prueba: no
distingue "sin test" de "con test que no corre en este proyecto".

**Fix sugerido.** Corregir H-05 primero y luego producir un reporte de cobertura
unificado (`vitest --coverage.reportsDirectory` sobre ambos proyectos, o
`--merge-reports`), extendiendo `include` a `app/**/actions*.ts`. Recién sobre esa
cifra tiene sentido subir el umbral.

---

### H-17 — Un test del PDTP falla en `main`: elige la actividad sin `ORDER BY` y asume que una ejecución no puede cumplir la meta

**Severidad: P2** · `[BUG]`

`lib/__tests__/prevention-pdtp.test.ts:2113-2120`;
`lib/services/pdtp/management-report.ts:147-168`;
`db/schema/prevention/pdtp.ts:55`

**Qué falla.** El test *"getPdtpManagementReport reports avance/desviaciones by
actividad and fails closed outside scope"* elige la actividad a ejecutar así:

```ts
const activities = await inMemoryDb.select().from(schema.pdtpActivities)
  .where(and(eq(...programId, program.id), eq(...scheduleMode, "scheduled")))
const target = activities[0]!            // ← sin ORDER BY
```

y luego exige que, tras ejecutar **una** unidad, esa actividad siga apareciendo
en el filtro `status: "deviates"`. Esa exigencia sólo se sostiene si la actividad
elegida tiene más de una unidad planificada en el año.

El servicio calcula `percent = executed / planned` como fracción 0-1
(`management-report.ts:151`) y `meetsTarget = percent >= program.complianceTarget`,
con `complianceTarget` por defecto `0.9` y acotado a `[0,1]` por el `check` del
esquema. Para una actividad de frecuencia anual (`planned = 1`), una ejecución
aprobada da `percent = 1.0`, `meetsTarget = true`, y el filtro `deviates` la
excluye — **correctamente**. La aserción de la línea 2120 es la que está mal.

**Cómo reproducir.**
`npx vitest run --config vitest.pglite.config.ts lib/__tests__/prevention-pdtp.test.ts`
→ `1 failed | 59 passed`, reproducible en aislamiento (233 s). Las aserciones
previas (2116-2119) pasan, de modo que la ejecución sí se registró y el resto de
las filas de `deviates` sí incumplen: lo único que falla es la presencia de
`target` en esa lista.

**Impacto.** Doble. (a) La suite del dominio PDTP está roja, así que aunque se
incorpore al CI (H-05) entraría fallando y habría que arreglar esto primero.
(b) Es un test dependiente del orden físico de filas: `SELECT` sin `ORDER BY` no
garantiza orden en Postgres, y un `UPDATE` de un test anterior reordena el heap.
Aunque hoy la aserción se corrija, el test seguirá siendo frágil.

**Fix sugerido.** Elegir explícitamente una actividad con plan mayor a uno, en
vez de confiar en el orden:

```ts
const activities = await inMemoryDb.select().from(schema.pdtpActivities)
  .where(and(eq(schema.pdtpActivities.programId, program.id),
             eq(schema.pdtpActivities.scheduleMode, "scheduled")))
  .orderBy(schema.pdtpActivities.n)                         // orden determinista

// Una actividad anual (planned = 1) cumple su meta con una sola ejecución:
// para probar "desviación" hace falta una con más de una unidad planificada.
const target = activities.find((a) => plannedFor(a) > 1)!
```

y, en la aserción, comprobar además `updatedTarget.percent < program.complianceTarget`
para que el motivo del filtro quede explícito.

---

## Hallazgos P3

### H-13 — `assertPeriodFloor` deja pasar períodos futuros justo en el modo que no los necesita

**Severidad: P3** · `[BUG]` · `lib/services/billing/sync.ts:435-446`

La guarda es `period > currentPeriod() && trigger !== "backfill"`. Un *backfill*
—por definición, recuperación de historia hacia atrás— es el único trigger
autorizado a pedir un mes futuro. `syncBillingInvoices({ trigger: "backfill",
period: "2027-06" })` crea una corrida contra un período que aún no existe y la
cierra en `success` con cero documentos, dejando ruido en el historial de
corridas. Fix: prohibir el futuro para todos los triggers.

### H-14 — `payloadHash` de las cartolas se calcula y nunca se usa

**Severidad: P3** · `[GAP]` · `lib/services/billing/sync.ts:314-338`; `db/schema/billing.ts:273`

Se computa un SHA-256 de `(externalId, fecha, monto)`, se persiste en una columna
`notNull` y jamás se lee: el upsert es `onConflictDoNothing`, así que una
corrección del banco (monto rectificado, fecha ajustada) nunca actualiza la fila
ni se detecta. O bien se compara el hash y se reporta la divergencia como
conflicto —el criterio que `upsertProviderInvoice` sí aplica a las facturas—, o
bien la columna sobra. Hoy sugiere una detección de cambios que no existe.

### H-15 — Revertir un pago lo deja `rejected`, y eso lo excluye para siempre del motor

**Severidad: P3** · `[BUG]` · `app/(app)/facturacion/cobranza/actions.ts:405-413`; `lib/services/billing/reconciliation.ts:286-300`

`revertPaymentAction` existe "porque confirmar es humano y equivocarse también",
y marca el pago `rejected`. Pero `generatePaymentSuggestions` salta cualquier par
`(factura, movimiento)` con **cualquier** imputación previa, incluidas las
rechazadas — comportamiento correcto y documentado para un descarte deliberado,
no para una reversión por error de dedo. Tras revertir, ese movimiento nunca
vuelve a proponerse contra esa factura y sólo puede imputarse a mano. Fix:
`verificationStatus: "reverted"` (o un flag) que el motor sí reconsidere.

### H-16 — El espaciado de solicitudes de Chipax no cubre el login

**Severidad: P3** · `[GAP]` · `lib/services/billing/providers/chipax.ts:246-290`

`get()` llama a `space()` **antes** de `authenticate()`, y `authenticate()` hace
su propio `fetch` a `/login` sin espaciar ni actualizar `lastRequestAt`. Cada
renovación de token dispara dos solicitudes consecutivas contra un límite de
60/min, y el reintento por 401 (línea 258-263) puede encadenar tres. Con una
sola corrida a la vez el margen alcanza; con dos alcances sincronizando en
paralelo, no. Fix: mover `space()` dentro de `authenticate()` también, o
centralizar el espaciado en un único `request()`.

---

## Controles verificados que no se reportan como bug

| Área | Evidencia |
|---|---|
| Aritmética de dinero | `lib/services/billing/money.ts` opera en unidades menores enteras, redondea una sola vez y `sumByCurrency`/`assertSameCurrency` impiden sumar monedas distintas. No se encontró aritmética nativa sobre montos en el módulo. |
| Identidad de factura | `billing_invoices_identity_unique` cubre `(direction, doc_type, folio, issuer_tax_id, receiver_tax_id)`. Una carrera entre dos proveedores no duplica la fila: falla el segundo `INSERT` y la corrida lo cuenta como error recuperable. |
| Sincronización sin RUT | `sync.ts:170-176` cuenta el documento como conflicto y lo reporta en vez de insertarlo con un RUT inventado. |
| Alcance de lectura de facturación | `invoiceScopePredicate` exige vínculo **confirmado**; una sugerencia automática no otorga visibilidad. Verificado contra Postgres real en `queries-scope.test.ts` (rol acotado ve cero filas, no filas ajenas). |
| Segregación en propuestas | `assertProposalTransition` impide que quien envió a revisión apruebe o rechace, exige motivo para observar/rechazar y bloquea `mark_ready` con antecedentes faltantes. |
| Resolución de duplicados | `resolveDuplicateAction` valida que `keepId` sea uno de los dos miembros del par y que el caso siga `open`; `dropId` se deriva, no se acepta del cliente. |
| Autenticación de crons | `billing-sales-sync` y `dte-portal-sync` exigen `CRON_SECRET` con `verifyCronSecret` (comparación en tiempo constante) y devuelven 401 si falta la variable. |
| Redacción de credenciales | Los mensajes de error de Chipax, del portal DTE y de las corridas de sincronización filtran `clave`, `rut_usr`, `token`, `app_id`, `secret_key`. `summarizeSettings` audita la contraseña como máscara, nunca en claro. |
| Caché RBAC | El callback `jwt` relee con `bypassCache = true` en cada request (`lib/auth/auth.ts:138-146`), así que un cambio de rol o de permisos de rol se propaga en el siguiente request sin depender del LRU de 5 s ni de `clearUserRbacCache`. |
| `sonner` / exports | Ningún componente importa `toast` de `sonner` fuera de `lib/toast.ts` y del `Toaster` de layout. No se encontró export CSV ni `writeToString`. |
| `redirect()` en acciones | Único uso en `app/(app)/recepcion/actions.ts:107`, fuera del `try`. |
| `db.*` sin `await` | El barrido no encontró mutaciones fire-and-forget en código de producción (los aciertos son mocks de tests). |
| `notifyAfterCommit` | Se usa consistentemente para diferir notificaciones fuera del commit; `notification-create.ts:242` encapsula el manejo de fallos. |
| Cierre automático de OC | `rollupOrderReceiptStatus` deriva el estado de las cantidades por línea y `notInArray(status, ['closed','cancelled'])` impide reabrir una OC cerrada a mano. |
| División por cero | `summarizeCompliance` devuelve `null` (no 0) sin ítems evaluables; `calculateCompliance` guarda `total > 0`; `computeVerificacionYCierre` devuelve `null` con listas vacías. |
| Cadena de migraciones | 139 entradas verificadas hasta `0138_worksite_admin_contrato_label`, sin drift. |

---

## Resultado de comandos de verificación

| Comando | Resultado | Evidencia |
|---|---|---|
| `npm run typecheck` | **PASS** | Código 0, sin errores. |
| `npm run lint` | **PASS** | Código 0, sin errores ESLint ni de reglas propias. |
| `npm run test:coverage` | **PASS con bandera** | Verde contra los umbrales configurados (40/30/40/40), pero 41,79 % statements y calculado sin las 53 suites PGlite → H-05, H-12. |
| `npm run db:verify-migrations` | **PASS** | 139 entradas verificadas hasta `0138_worksite_admin_contrato_label`. |
| `npm run check:secrets` | **PASS** | `Env files check passed.` |
| `npm run check:security-audit` | **FAIL** | `GHSA-rgw5-rvv9-x895` (brace-expansion) fuera del allowlist → H-06. |
| `npm audit --audit-level=high` | **FAIL** | 3 vulnerabilidades altas: `brace-expansion` (2 advisories, 3 rutas) y `sharp` anidado en `next`. Ambas familias ya analizadas por alcanzabilidad en el informe de julio; sólo el advisory nuevo carece de justificación. |
| `npm run check:bundle-budget` | **NO EJECUTADO** | Requiere `npm run build` previo; no se ejecutó un build en esta pasada. |
| `npx gitleaks detect --source . --no-git` | **NO EJECUTABLE** | `npm ERR! could not determine executable to run` — `gitleaks` no está instalado ni resoluble vía npx en este entorno. El gate real de secretos es `npm run check:secrets`, que sí pasa. |
| `npm run test:pglite` | **FAIL** | 53 archivos / 484 tests, 724 s. `1 failed \| 52 passed` (archivos), `1 failed \| 483 passed` (tests). El fallo es `prevention-pdtp.test.ts:2120`, reproducible en aislamiento → H-17. Esta suite no la ejecuta ningún gate (H-05). |

---

## Apéndice A — Archivos PGlite fuera de todo gate (H-05)

Los 53 de `tests/pglite-files.ts`. Los que cubren un hallazgo cerrado en la
auditoría anterior van marcados:

| Archivo | Cubre |
|---|---|
| `lib/__tests__/purchasing-service.test.ts` | P0-01, P1-05, P1-15, P2-30 |
| `lib/__tests__/receiving-two-stage.test.ts` | P0-02, P1-06 |
| `lib/__tests__/item-state-mutations.test.ts` | P1-03, P1-04, P2-24 |
| `lib/__tests__/physical-inventory-service.test.ts` | P1-07, P1-08 |
| `lib/__tests__/stock-service.test.ts` | P1-09 |
| `lib/__tests__/full-flow-integration.test.ts` | P1-10, P1-12 |
| `lib/__tests__/epp-replenishment.test.ts` | P1-13 |
| `lib/__tests__/requests-delete.test.ts` | P1-21 |
| `lib/__tests__/feedback.test.ts` | P1-19 |
| `lib/__tests__/code-sequences.test.ts` | §13.2 correlativos |
| `lib/services/billing/__tests__/sync-integration.test.ts` | módulo nuevo |
| `lib/services/billing/__tests__/queries-scope.test.ts` | módulo nuevo |
| `lib/services/billing/__tests__/payments-integration.test.ts` | módulo nuevo |
| `lib/services/billing/__tests__/duplicates-integration.test.ts` | módulo nuevo |
| *(+39 archivos más: PDTP, prevención, combustibles, trazabilidad, RBAC, esquema)* | — |

---

## Registro de remediación

Ronda de implementación 2026-08-05, sobre plan aprobado. Alcance de la ronda:
los 6 P1 más el prerrequisito H-17. H-07…H-16 (6 P2 + 4 P3) quedan fuera de
esta ronda a propósito — ver la tabla de pendientes al final de esta sección.
Decisión de producto para H-04 (confirmada por el usuario): escala ternaria,
Regular = 0,5, alineada con `lib/sst/compliance.ts` ya en producción.

### Pasada 1 — 2026-08-05

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-06 | Implementado | `scripts/check-security-audit.ts`: tercer objeto en `AUDIT_ALLOWLIST` (índice 2, al final — los tests acoplan `[0]`/`[1]` por índice) para `GHSA-rgw5-rvv9-x895`, misma justificación de alcanzabilidad que `GHSA-mh99-v99m-4gvg` (mismo paquete `brace-expansion`, misma ruta `archiver → readdir-glob`, mismo guardrail `findStreamingWorkbookWriterUsage`). Mensaje de error del guardrail actualizado para nombrar ambos GHSA. |

Verificación: `npm run check:security-audit` (verde: "hallazgos altos cubiertos por el allowlist documentado"), `npx vitest run scripts/check-security-audit.test.ts` (13/13 verdes, fixtures por índice intactas).

### Pasada 2 — 2026-08-05

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-17 | Implementado | `lib/__tests__/prevention-pdtp.test.ts`: el test de `getPdtpManagementReport` elegía `activities[0]` sin `ORDER BY` y asumía que una ejecución no puede cumplir una meta anual. Ahora elige explícitamente, desde el `report` ya calculado, una actividad con `planned > 1` (`report.activities.find(row => row.planned > 1)`), y la aserción agrega `expect(updatedTarget.percent).toBeLessThan(program.complianceTarget)` para dejar explícito el motivo de la desviación. |
| H-05 | Implementado | `.github/workflows/ci.yml`: paso nuevo "Integration tests (PGlite, serial)" (`npm run test:pglite`), insertado después de "Unit tests con NEXT_PUBLIC_SENTRY_DSN definido" y antes de los tres pasos `*-postgres.test.ts`. Sin `env:` propio — `vitest.pglite.config.ts` ya fija su `DATABASE_URL`/`PGHOST`, así que no toca el Postgres real de servicio del job. YAML validado con un parser (`js-yaml`) contra el archivo completo. |

Verificación: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/prevention-pdtp.test.ts` (60/60 verdes, aislado), luego `npm run test:pglite` completo: **53 archivos / 485 tests, todos verdes** (antes: 1 archivo y 1 test fallidos). El paso nuevo de `ci.yml` se validó sintácticamente (YAML parseable, orden de pasos correcto); no se dispuso de una corrida de GitHub Actions real para confirmar tiempos de job.

### Pasada 3 — 2026-08-05

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-01 | Implementado | `lib/services/billing/reconciliation.ts`: nuevas `confirmPaymentSuggestion`/`revertConfirmedPayment`, con `lockBankTransaction` (`SELECT … FOR UPDATE`) sobre `billing_bank_transactions` antes de `assertAllocationFits`, más `UPDATE billing_invoice_payments … WHERE id = ? AND verification_status = ?` comprobando `.returning()` — mismo patrón canónico que `approveItem` (`lib/services/item-state-module/approval.ts`). `app/(app)/facturacion/cobranza/actions.ts` (`resolvePaymentSuggestionAction`, `revertPaymentAction`) quedan como wrappers finos que llaman a estas funciones dentro de `db.transaction`. H-15 (P3, mismo archivo) queda deliberadamente fuera de esta ronda. |
| H-02 | Implementado | `lib/services/billing/duplicates.ts`, `mergeDuplicate`: tras mover los pagos de `dropId` a `keepId`, llama a `recomputeInvoicePaymentStatus` para **ambos** ids (antes solo se movían las filas, sin rederivar `paid_amount`/`payment_status` de ninguna de las dos facturas). |

Verificación: nuevo `lib/__tests__/billing-payments-concurrency-postgres.test.ts` (2 pruebas) contra Postgres real (`bodega_billing_test`, `PGHOST=/var/run/postgresql`) — dos confirmaciones concurrentes sobre el mismo movimiento: exactamente una `fulfilled`, `allocated_amount` nunca excede `amount`; y una carrera confirmar/revertir donde `allocated_amount` final coincide exactamente con la suma de pagos `confirmed`. `lib/services/billing/__tests__/duplicates-integration.test.ts` extendido con el caso exacto del hallazgo (A sin pagos + B con pago confirmado → A queda `paid` con el monto trasladado, B queda `unpaid`): 11/11 verdes. `ci.yml` actualizado con `BILLING_PAYMENTS_CONCURRENCY_DATABASE_URL`/`_ALLOW_DESTRUCTIVE_RESET` en el paso "Concurrency tests (real Postgres)" — el glob `*concurrency-postgres.test.ts` ya captura el archivo nuevo sin paso aparte. `npx tsc --noEmit` y `npm run lint` verdes.

### Pasada 4 — 2026-08-05

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-03 | Implementado | `lib/services/dte-portal/sync.ts`, `syncDteDocuments`: el corte por "ya sincronizado" ahora sólo aplica cuando `periodo < currentPeriodo()` (período cerrado); el mes en curso ya no consulta siquiera la corrida previa. `app/(app)/admin/dte/actions.ts`: se separó en `triggerDteSyncAction()` (sin argumentos, compatible con `useActionState`, siempre mes en curso) y `forceDteSyncPeriodAction({ periodo })` (fuerza un período específico) — necesario porque `useActionState` exige una firma `(prevState, formData)` incompatible con recibir parámetros directos. `app/(app)/admin/dte/dte-sync-actions.tsx`: segundo control (selector de período + botón "Forzar re-sincronización" con su propio `ConfirmDialog`) para re-sincronizar un período ya cerrado a mano. |

Verificación: `lib/services/dte-portal/__tests__/sync.test.ts` extendido con 3 casos (12/12 verdes): un período cerrado con corrida previa sigue devolviendo `skipped`; el período **en curso** nunca consulta la corrida previa (`mockSyncRunsFindFirst` no se llama) y siempre re-sincroniza; un período cerrado admite forzarse explícitamente. `npx tsc --noEmit` y `npm run lint` verdes.

### Pasada 5 — 2026-08-05

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-04 | Implementado | Decisión de producto (confirmada por el usuario): escala ternaria, Regular = 0,5, alineada con `lib/sst/compliance.ts` ya en producción — el plan de formularios 2026 que proponía colapsar Regular a no_cumple se da por superado en este punto. **Esquema** (`db/schema/prevention/inspections.ts`, migración `0139_sad_maddog.sql`): el CHECK de `prevention_inspection_answers.result` admite `'partial'`; columna `partial_count` en `prevention_inspection_runs` con su propio `>= 0` en el CHECK combinado; nuevo CHECK `prevention_inspection_answer_requires_comment` (reemplaza al que sólo cubría `not_applicable`) exige comentario también para `partial`, igual que `requiresObservation` en el motor SST — deliberadamente **no** se extendió a `non_conforming`, que sigue sin exigirlo (fuera de alcance de H-04). **Motor transversal** (`lib/prevention/inspections.ts`): `InspectionItemSpec.kind` (antes descartado en `itemsFromDefinition`), `fieldKindAcceptsPartial` (sólo los 3 `FieldKind` B/R/M lo admiten), `summarizeCompliance` pondera `partial` con `PARTIAL_STATUS_WEIGHT` importado de `lib/sst/compliance.ts` (mismo peso, una sola fuente), `assessRunCompletion` exige motivo para `partial` igual que para `not_applicable`, `resultBadgeVariant` nuevo (antes un estado no reconocido cala al `else` de "success" por accidente — el riesgo de UI que el hallazgo señalaba). `lib/services/prevention-inspections.ts`: `itemsFromDefinition` propaga `kind`; `answersSchema` admite `"partial"`; `saveInspectionAnswers` rechaza `partial` en un ítem que no es B/R/M; `completeInspectionRun` escribe `partialCount`. UI (`inspection-run-detail.tsx`) y export CSV (`prevention-inspections-export.ts`) actualizados. `pdtp/compliance.ts` (`computeVerificacionYCierre`) no requirió cambios: promediaba dos escalas incompatibles porque las escalas eran incompatibles, no porque el promedio estuviera mal — con ambas fuentes puntuando igual, el promedio ya es correcto. |

Verificación: `lib/__tests__/prevention-inspections-calc.test.ts` extendido con 7 casos (35/35 verdes) — incluye el ejemplo exacto del hallazgo (8 buenos + 2 regulares de 10 → 90%, no 80% ni 100%) y una prueba que compara `summarizeCompliance` contra `calculateCompliance` de `lib/sst/compliance.ts` sobre el mismo checklist, confirmando paridad exacta entre motores (el criterio de cierre que el propio hallazgo pedía). `lib/__tests__/prevention-inspections-postgres.test.ts` extendido con 2 casos contra Postgres real (`bodega_prevention_inspections_test`): rechazo de `partial` en un ítem cumple/no-cumple puro (plantilla de extintores), y persistencia end-to-end sobre `inspeccion_carros` (100% B/R/M) verificando `partialCount` y `compliancePercent` almacenados — 18/18 verdes. `npm run db:generate` posterior sin cambios, `npm run db:verify-migrations` (140 entradas), `npx tsc --noEmit` y `npm run lint` verdes.

**Nota sobre el árbol de trabajo:** al generar la migración, `drizzle-kit generate` intentó incluir `ALTER TABLE "worksites" ADD COLUMN "admin_contrato_label"` — una columna ya agregada por una migración `0138` hand-authored por otra sesión concurrente en este mismo checkout, cuyo snapshot nunca se regeneró (`db/migrations/meta/` salta de `0136_snapshot.json` a `0139_snapshot.json`). Se retiró esa línea de la migración de esta ronda (ajena a H-04); no se tocó nada del trabajo concurrente.

### Verificación final de la ronda — 2026-08-05

Ejecutada después de cerrar las 5 fases, sobre el árbol completo con todos los
cambios de H-01 a H-06 y H-17:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** — sin errores. |
| `npm run lint` | **PASS** — 0 errores, 5 warnings preexistentes ajenos a esta ronda (ninguno en archivos tocados). |
| `npm run test:coverage` | **PASS** — statements 41,8 % (levemente sobre el 41,79 % previo, por los tests nuevos), umbrales configurados (40/30/40/40) cumplidos. |
| `npm run test:pglite` | **PASS** — **53/53 archivos, 485/485 tests** (antes de esta ronda: 1 archivo y 1 test fallidos — H-17). |
| `*concurrency-postgres.test.ts` (glob completo, incluida `billing-payments-concurrency-postgres.test.ts` nueva) | **PASS** — 6 archivos, 10/10 tests, contra Postgres real. |
| `npm run db:verify-migrations` | **PASS** — 140 entradas verificadas hasta `0139_sad_maddog`. |
| `npm run check:security-audit` | **PASS** — allowlist cubre los 3 GHSA, incluido el nuevo de H-06. |
| `npm run check:secrets` | **PASS**. |
| `npm run build` | **PASS** — sin errores, 171 rutas compiladas. |
| `npm run check:bundle-budget` | **PASS** — peor ruta `/combustibles/facturas` 2,42 MB de 3,00 MB de presupuesto. |

No se ejecutó una corrida real de GitHub Actions (fuera del alcance de esta
sesión): la verificación del paso nuevo de `ci.yml` es sintáctica (YAML
parseable, orden de pasos correcto) más la ejecución local de cada comando que
ese paso invoca.

### Pendiente después de la primera ronda

| Prioridad | Hallazgos aún abiertos |
|---|---|
| P2 | H-07 `syncBankTransactions` sin `markStaleRunsAsFailed`; H-08 alcance por faena en escrituras de facturación fuera de Cobranza; H-09 catch ciego en `billing_sync_runs`; H-10 sin índice único parcial en `dte_sync_runs`; H-11 `nextProposalCode` no usa el secuenciador central; H-12 cobertura unificada tras H-05. |
| P3 | H-13 `assertPeriodFloor` invertido para backfill; H-14 `payloadHash` de cartolas nunca se lee; H-15 revertir un pago lo excluye para siempre del motor de sugerencias (mismo archivo que H-01, bundleable barato); H-16 espaciado de Chipax no cubre el login. |

Los 6 P1 y H-17 de esa ronda quedaron cerrados con evidencia verificable. Ningún P0 estaba abierto. El dictamen No-GO del resumen ejecutivo (H-01/H-02) quedó levantado.

*(Los 10 hallazgos de esta tabla se cerraron en la segunda ronda — pasadas 6 a 11, abajo.)*

---

## Segunda ronda — 2026-08-05: los 10 P2/P3 restantes

Cierra los 6 P2 y 4 P3 que la primera ronda dejó fuera por alcance. Sin
hallazgos nuevos: mismo informe, mismo criterio de cierre.

### Pasada 6 — H-07 + H-09 + H-13 + H-14 (grupo `billing/sync.ts`)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-07 | Implementado | `syncBankTransactions` llama `markStaleRunsAsFailed(provider, "bank_transactions")` antes de insertar su corrida, igual que `syncBillingInvoices`. Una corrida de cartolas cuyo proceso murió ya no bloquea el período de forma indefinida vía el índice único parcial. |
| H-09 | Implementado | Los dos `catch` que envolvían el `INSERT` en `billing_sync_runs` sólo tratan como "ya hay una corrida en curso" el conflicto del índice único; cualquier otro error se propaga. Nuevo `isSingleActiveRunConflict`, que **recorre la cadena de `cause`**: Drizzle envuelve el error del driver, así que el SQLSTATE `23505` y el nombre de la restricción no están en el error de arriba. Se exige el nombre del índice, no sólo el código: otra violación de unicidad de la misma tabla no significa lo mismo. |
| H-13 | Implementado | `assertPeriodFloor` prohíbe el período futuro para **todos** los triggers y ya no recibe `trigger`: un backfill recupera historia hacia atrás, y la guarda anterior le permitía justo lo contrario. |
| H-14 | Implementado | El `payloadHash` de las cartolas pasa de calcularse-y-nunca-leerse a ser la detección de cambios que su nombre promete: si el proveedor rectificó fecha o monto de un movimiento ya importado, se cuenta como conflicto y se reporta, **sin** sobrescribir la fila (pisarla corrompería la imputación acumulada). Extraído a `bankTransactionHash`, con los campos del hash deliberadamente estables para no marcar como divergentes las filas ya importadas. |

Verificación: `lib/services/billing/__tests__/sync-integration.test.ts` extendido con 5 casos (32/32 verdes) — corrida de cartolas colgada que ya no bloquea el período, rectificación de monto detectada como conflicto sin pisar `amount` ni `allocated_amount`, reimportación idéntica que no es conflicto, backfill con período futuro rechazado, y un fallo real de base (FK a un usuario inexistente) que se propaga en vez de disfrazarse de "ya en curso". **El test de este último caso detectó un defecto en la primera versión del fix** (`error.code` no existe en el nivel superior porque Drizzle envuelve el error), corregido antes de cerrar la pasada.

### Pasada 7 — H-15 + H-10 (estado `reverted` e índice de corrida única DTE)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-15 | Implementado | Estado nuevo `reverted` en `billing_invoice_payments.verification_status` (migración `0140_white_darwin.sql`). `revertConfirmedPayment` lo usa en vez de `rejected`, y `generatePaymentSuggestions` vuelve a proponer los pares `reverted` pero sigue respetando `rejected` para siempre: descartar es una decisión sobre el vínculo, revertir es corregir un error de dedo. Como el índice único `(factura, movimiento)` impide insertar otra fila para el mismo par, la reversión se **reactiva** en su lugar, conservando la traza de quién revirtió y por qué. |
| H-10 | Implementado | Índice único parcial `dte_sync_runs_single_active_unique` sobre `(cod_emp, periodo) WHERE status = 'running'`, equivalente al que ya tenía facturación. `syncDteDocuments` trata su conflicto como "ya hay una sincronización en curso" (con el mismo recorrido de la cadena de `cause` que H-09) y propaga cualquier otro error. La migración incluye una limpieza defensiva previa: sin ella, `CREATE UNIQUE INDEX` fallaría en una base que ya tuviera dos corridas `running` del mismo período — justo la carrera que el índice viene a cerrar. |

Verificación: `payments-integration.test.ts` (16/16) con el caso de reactivación tras reversión, incluida la comprobación de que se reactiva la misma fila y de que el evento registra `reactivatedFrom: "reverted"`; `dte-portal/__tests__/sync.test.ts` (14/14) con corrida concurrente que se salta y fallo real de base que se propaga.

### Pasada 8 — H-11 (secuenciador central de códigos)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-11 | Implementado | `nextProposalCode` usa `nextCodeTx(tx, "PF", year)` —la SEQUENCE nativa de Postgres que ya usan SOL, OC, REC, AJU y DEV— en vez de `count(*) + 1`. El formato de `generateCode` produce exactamente el mismo `PF-2026-0007`, así que no hay cambio visible. El modo anterior retrocedía el contador al borrarse una fila y quedaba colisionando de forma permanente con un código ya emitido. |

Verificación: `npx tsc --noEmit` y `npm run lint` verdes; el comportamiento queda cubierto por las suites de propuestas existentes.

### Pasada 9 — H-16 (espaciado del login de Chipax)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-16 | Implementado | `authenticate()` espacia su propio `POST /login`, y `get()` mueve su `space()` a **después** de autenticar. Así cada solicitud HTTP real queda precedida por su propia espera; antes la espera del GET se consumía antes del login y ambas salían pegadas contra un límite de 60/min. |

Verificación: `providers.test.ts` (23/23) con un caso que fuerza la renovación de token en cada consulta (el escenario donde login y GET salían juntos) y comprueba que las dos solicitudes están separadas por al menos el espaciado configurado.

### Pasada 10 — H-08 (alcance por faena en escrituras de facturación)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-08 | Implementado | `canReachInvoice` se promueve de función privada de Cobranza a `lib/services/billing/queries.ts`, junto al predicado de lectura del que es la contraparte puntual, y se agrega `canReachProposal`. Se aplican en las 5 acciones que no las tenían: `updateInvoiceInternalDataAction`, `linkInvoiceAction`, `rejectInvoiceLinkAction`, `confirmInvoiceLinkAction` y la rama de edición de `saveProposalAction`. En `linkInvoiceAction` la guarda va **antes** de crear el vínculo, que es lo que cerraba la escalada: el vínculo nace `confirmed` y, sin verificar primero, pasaba de reflejar el permiso a otorgarlo. |

Verificación: `queries-scope.test.ts` extendido con 5 casos (32/32 verdes), incluido uno que compara la guarda de escritura contra el modelo de lectura factura por factura — *lo que no se puede ver, no se puede escribir*. Nota: una factura sin vínculo confirmado deja de ser escribible por un rol acotado, lo cual es consistente con que `listUnlinkedInvoices` ya le devolvía `[]`; el primer vínculo de una factura lo crea un rol global.

### Pasada 11 — H-12 (cobertura unificada y umbral con sentido)

| Hallazgo | Estado | Implementación y evidencia |
|---|---|---|
| H-12 | Implementado | `vitest.coverage.shared.ts` centraliza `include`/`exclude`/umbrales para que ambos proyectos midan lo mismo y sus reportes sean combinables. Tres correcciones sobre el alcance de la medición: (1) el `include` incorpora las Server Actions (`app/**/actions*.ts`), la frontera de escritura de la aplicación, que quedaba fuera del denominador pese a concentrar permisos, validación y alcance; (2) el `exclude` descarta el código de prueba — declarar un `exclude` propio reemplaza los defaults de Vitest, así que los `*.test.ts` estaban entrando al denominador; (3) `excludeAfterRemap: true`, sin lo cual ese `exclude` se evalúa sobre paths transformados y no descarta nada. Scripts nuevos `test:coverage:unit`/`:pglite`/`:merge`/`:all` y `vitest.merged.config.ts` producen la cifra combinada vía blobs. En `ci.yml`, los dos pasos de test que ya existían ahora emiten blob y un tercer paso corto aplica el umbral sobre la combinación: **no re-ejecuta ningún test, así que no cuesta minutos de job**. |

**Lo que la medición honesta reveló.** La cobertura real combinada sobre `lib/**` + Server Actions, sin código de prueba en el denominador, es:

```
Statements   : 57.37% ( 16045/27966 )
Branches     : 47.76% ( 10574/22139 )
Functions    : 60.78% (  2964/4876  )
Lines        : 60.81% ( 14240/23415 )
```

El 41,79 % que este informe reportó como bandera describía otra cosa: sólo el
proyecto rápido, sólo `lib/**`, y con los propios tests inflando el
denominador. Es exactamente lo que H-12 señalaba —"no distingue *sin test* de
*con test que no corre en este proyecto*"— y por eso el hallazgo pedía no tocar
el umbral antes de unificar. Los umbrales suben de 40/30/40/40 a **55/45/57/57**,
unos puntos bajo el valor real para absorber fluctuación sin volverse ruido.

Verificación: `npm run test:coverage:all` completo (unit + 53 suites PGlite + merge) con los umbrales nuevos en verde. Nota de implementación verificada empíricamente: `--mergeReports` respeta `thresholds` pero **ignora** `include`/`exclude` —quedan grabados en cada blob al recolectar—, así que el alcance vive en las configs de origen y sólo el umbral en la del merge. Se comprobó con un `include` de un solo archivo que no alteró el resultado.

### Verificación final de la segunda ronda — 2026-08-05

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** — 0 errores, 5 warnings preexistentes ajenos a esta ronda |
| `npm run db:generate` posterior | **PASS** — "No schema changes, nothing to migrate" |
| `npm run db:verify-migrations` | **PASS** — 141 entradas hasta `0140_white_darwin` |
| `npm run test:coverage:all` | **PASS** — 57,37 % statements sobre umbral 55 |
| `npm run test:pglite` | **PASS** — 53/53 archivos, 496/496 tests |
| `*concurrency-postgres.test.ts` (glob de CI) | **PASS** — 6 archivos, 10/10, contra Postgres real |
| `prevention-inspections-postgres.test.ts` | **PASS** — 18/18, contra Postgres real |
| `npm run check:security-audit` | **PASS** |
| `npm run check:secrets` | **PASS** |
| `npm run build` + `check:bundle-budget` | **PASS** |

### Estado final del informe

Los **17 hallazgos** están cerrados con evidencia verificable: 6 P1 + H-17 en la
primera ronda, 6 P2 + 4 P3 en la segunda. Ningún P0 estaba abierto.

Sigue sin ejecutarse una corrida real de GitHub Actions (fuera del alcance de
estas sesiones): la verificación de los pasos nuevos de `ci.yml` es sintáctica
—YAML parseable, orden de pasos correcto— más la ejecución local de cada
comando que esos pasos invocan.

## Criterio de cierre

| Hallazgo | Condición de cierre |
|---|---|
| H-01 | Prueba de concurrencia contra Postgres real: dos confirmaciones simultáneas sobre el mismo movimiento; exactamente una debe quedar `confirmed` y `allocated_amount ≤ amount`. |
| H-02 | Prueba de integración: fusionar A(sin pagos) con B(pago confirmado) deja A con `payment_status = 'paid'` y `paid_amount` igual al pago trasladado. |
| H-03 | Prueba de que dos corridas del período en curso consultan el portal las dos veces, y una del período anterior con `success` previo sigue devolviendo `skipped`. |
| H-04 | Decisión de contrato registrada en `ARCHITECTURE.md` + migración + prueba de que el mismo anexo puntúa igual por ambos motores. |
| H-05 | `npm run test:pglite` verde como paso obligatorio en `ci.yml`, más la prueba de contrato del registro de archivos. |
| H-06 | `npm run check:security-audit` en verde con la justificación de alcanzabilidad escrita y su fecha de re-revisión. |
| H-17 | El test elige la actividad con orden determinista y con plan mayor a uno; `npm run test:pglite` en verde. Es prerrequisito de H-05. |
| H-07 … H-16 | Fix + prueba localizada; los P3 admiten cierre por decisión documentada. |
