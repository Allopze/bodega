# Rollback

## Qué tan reversible es

**Casi.** El módulo en sí (`0136_billing_module`) fue aditivo puro: 15 tablas
nuevas, cero datos existentes tocados. Pero las migraciones **posteriores** ya no
lo son, y planificar la reversión sin ellas deja la base inconsistente.

Lo que cambió después de `0136` sobre tablas que ya existían:

| Migración | Qué hizo |
|---|---|
| `0140_white_darwin` | Reemplazó el CHECK `billing_invoice_payments_status_valid` para admitir `'reverted'` (el estado que escribe `reconciliation.ts` al revertir un pago). Además cerró corridas `running` colgadas en `dte_sync_runs` y creó el índice único `dte_sync_runs_single_active_unique`. |
| `0153_omniscient_war_machine` | `dte_sync_runs ADD COLUMN correlation_id` + índice. |
| `0154_tiny_tomorrow_man` | Tabla nueva `dte_portal_operation_leases` (aditiva). |
| `0156_cute_tana_nile` | `dte_documents ADD COLUMN portal_record_id` + índice + CHECK `dte_documents_single_business_link`. |
| `0159_motionless_bishop` | `dte_sync_runs ADD COLUMN reconciliation_status` (NOT NULL default `'not_run'`) y `reconciliation_error`, CHECK `dte_sync_runs_reconciliation_status_valid`, índices `dte_documents_purchase_invoice_single_unique` y `dte_sync_runs_reconciliation_status_idx`. |

O sea: `dte_documents` y `dte_sync_runs` **no** funcionan igual que antes, y
`0140` toca las dos mitades a la vez (facturación y DTE). Esa mezcla es la que
obliga a tratar `0140` con cuidado en el Nivel 4.

## Nivel 1 — Apagar el módulo (segundos, sin perder nada)

```bash
BILLING_SALES_SYNC_ENABLED=false
```

Detiene la sincronización automática. Los datos quedan intactos y las pantallas
siguen consultables.

## Nivel 2 — Ocultar el módulo (minutos)

Quitar los permisos `billing:*` de todos los roles desde Administración, o
comentar `billingModule` en `modules/registry.ts` y desplegar. La navegación y
el tipo `Permission` se derivan del registry, así que el módulo desaparece de la
interfaz sin tocar nada más.

Los datos siguen en la base.

## Nivel 3 — Revertir el código

```bash
git revert <commit-del-módulo>
```

Las tablas quedan huérfanas pero **no estorban**: ninguna otra parte del sistema
las referencia.

## Nivel 4 — Revertir el esquema (destructivo)

⚠ **Esto borra los datos de facturación y cobranza.** Respaldar antes.

```sql
BEGIN;
DROP TABLE IF EXISTS billing_duplicate_candidates;
DROP TABLE IF EXISTS billing_invoice_events;
DROP TABLE IF EXISTS billing_sync_runs;
DROP TABLE IF EXISTS billing_proposal_items;
DROP TABLE IF EXISTS billing_collection_actions;
DROP TABLE IF EXISTS billing_invoice_payments;
DROP TABLE IF EXISTS billing_bank_transactions;
DROP TABLE IF EXISTS billing_invoice_links;
DROP TABLE IF EXISTS billing_proposals;
DROP TABLE IF EXISTS billing_external_refs;
DROP TABLE IF EXISTS billing_invoice_items;
DROP TABLE IF EXISTS billing_invoices;
DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS client_contacts;
DROP TABLE IF EXISTS clients;

-- `0140` también se retira: es la que agregó `'reverted'` al CHECK de
-- `billing_invoice_payments`. Retirar sólo `0136` deja `0140` marcada como
-- aplicada, así que al reconstruir vuelve el CHECK viejo de tres valores y
-- «Revertir» un pago falla con violación de constraint — justo la operación
-- que hace falta después de un rollback.
--
-- `0140` se reaplica entera, y su `CREATE UNIQUE INDEX` fallaría con "already
-- exists" si el índice sigue ahí: hay que soltarlo antes. Se recrea solo.
DROP INDEX IF EXISTS dte_sync_runs_single_active_unique;

DELETE FROM drizzle.__drizzle_migrations
 WHERE tag IN ('0136_billing_module', '0140_white_darwin');
COMMIT;
```

El orden respeta las claves foráneas. Después, `npm run db:migrate` reconstruye
`0136` y `0140` (la parte DTE de `0140` es idempotente: vuelve a cerrar corridas
colgadas, si las hubiera, y recrea el índice).

`0153`, `0154`, `0156` y `0159` **no** se tocan: sólo afectan `dte_documents`,
`dte_sync_runs` y `dte_portal_operation_leases`, que son de Compras y siguen en
uso.

### Si la reversión es definitiva (se retira el módulo del repositorio)

Además de lo anterior hay que sacar `0136_billing_module` de
`db/migrations/meta/_journal.json` y borrar su `.sql`, o `db:verify-migrations`
reclamará. **`0140` no se puede borrar**: creó `dte_sync_runs_single_active_unique`,
que Compras sí usa. Hay que editarla para dejar sólo sus sentencias de
`dte_sync_runs` y quitar las dos que hablan de `billing_invoice_payments`; si no,
la reconstrucción desde cero falla al no existir esa tabla.

## Qué NO revierte nada de esto

- Los documentos ya sincronizados **en el portal**: la plataforma solo lee.
- Los documentos de compra en `dte_documents`: son de otro sistema.
- Cualquier documento tributario: la plataforma **nunca emitió ninguno**.

## Respaldo previo recomendado

```bash
pg_dump -t 'billing_*' -t clients -t client_contacts -t contracts \
        "$DATABASE_URL" > respaldo-facturacion-$(date +%F).sql
```
