# Rollback

## Qué tan reversible es

**Completamente.** La implementación es aditiva pura:

- 15 tablas nuevas;
- **cero** columnas agregadas, modificadas o eliminadas en tablas existentes;
- **cero** datos existentes tocados;
- el módulo de Compras y su sincronización DTE quedaron **intactos**.

`dte_documents`, `dte_sync_runs` y todo `lib/services/dte-portal/*` funcionan
exactamente igual que antes. Las únicas modificaciones a archivos existentes son
adiciones: un área de navegación, tres iconos, dos exportaciones de esquema, una
línea en el registry y variables nuevas en `.env.example`.

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
DELETE FROM drizzle.__drizzle_migrations WHERE tag = '0136_billing_module';
COMMIT;
```

El orden respeta las claves foráneas. Después hay que quitar la entrada
`0136_billing_module` de `db/migrations/meta/_journal.json` y borrar el `.sql`,
o `db:verify-migrations` reclamará.

## Qué NO revierte nada de esto

- Los documentos ya sincronizados **en el portal**: la plataforma solo lee.
- Los documentos de compra en `dte_documents`: son de otro sistema.
- Cualquier documento tributario: la plataforma **nunca emitió ninguno**.

## Respaldo previo recomendado

```bash
pg_dump -t 'billing_*' -t clients -t client_contacts -t contracts \
        "$DATABASE_URL" > respaldo-facturacion-$(date +%F).sql
```
