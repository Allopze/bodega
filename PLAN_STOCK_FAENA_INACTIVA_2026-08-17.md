# Plan — stock huérfano al desactivar una faena

**Fecha:** 2026-08-17
**Origen:** al cerrar una faena, `setWorksiteActive` cancela CAPA, obligaciones PDTP y
la saca de sus programas, pero no toca `worksite_stock`. El saldo queda ligado a una
faena inactiva: invisible en Bodega (la consulta filtra `worksites.isActive = true`) e
inmovible (`applyMovementTx` rechaza todo movimiento sobre faena inactiva). No existe
camino de vuelta: la guía de despacho interna es sólo Oficina → Faena.

## Objetivo

Que sea imposible crear inventario huérfano, que el que ya exista sea visible, y —si
se decide— que exista una salida operativa que no obligue a reactivar la faena.

---

## Fase 0 — Saber si el problema ya existe ✅

- [scripts/diagnose-orphan-stock.ts](scripts/diagnose-orphan-stock.ts), read-only, expuesto
  como `npm run db:diagnose-orphan-stock`: lista faenas `isActive = false` con filas en
  `worksite_stock` de `quantity > 0`, agrupadas por faena.
- **Resultado en desarrollo (2026-08-17): 0 faenas, 0 existencias atrapadas.**
- **Resultado en producción (2026-08-17): 0 filas.** Nunca se cerró una faena con saldo,
  así que no hay nada que regularizar (Fase 4).

El script vive en la imagen `build`, no en la `prod` (que omite `tsx` y el código
TypeScript a propósito). Para consultarlo en producción sin desplegar nada, la misma
consulta corre contra el contenedor de base de datos:

```bash
cd /server/plataforma
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT w.name AS faena, w.code, p.sku, p.name AS producto,
       ws.quantity, p.unit_of_measure AS unidad
FROM worksite_stock ws
JOIN worksites w ON w.id = ws.worksite_id
JOIN products  p ON p.id = ws.product_id
WHERE w.is_active = false AND ws.quantity > 0
ORDER BY w.name, p.name;
SQL
```

---

## Fase 1 — Bloquear el cierre con saldo (el fix real) ✅

Es la corrección de raíz: un solo guard en el único lugar por donde pasa la
desactivación, no un aviso en la UI que se pueda saltar por otra vía.

### 1.1 Guard en `lib/services/worksite-lifecycle.ts`

Dentro de la misma transacción, después del `FOR UPDATE` sobre `worksites` y antes de
cancelar nada: si `!input.activate`, contar `worksite_stock` de esa faena con
`quantity > 0`. Si hay filas, lanzar con detalle accionable:

> No se puede cerrar la faena: quedan N productos con existencias (M unidades).
> Entrega, desecha o ajusta el saldo antes de cerrarla.

El conteo va antes de las cancelaciones para que el rollback no tenga trabajo que
deshacer.

### 1.2 `toggleWorksiteActive` debe atrapar el error

Hoy `setWorksiteActive` se llama sin `try/catch` en
[app/(app)/admin/faenas/actions.ts:107](<app/(app)/admin/faenas/actions.ts#L107>): un
throw revienta la server action y el usuario ve el error genérico de Next en vez del
motivo. Envolver y devolver `{ ok: false, message }` — el diálogo de cierre ya muestra
`state.message` vía el toast de `useCatalogSheet`.

### 1.3 Cerrar la ventana TOCTOU

El `FOR UPDATE` del cierre bloquea sobre `worksites`, pero `applyMovementTx` lee esa
fila con `findFirst` sin lock: una recepción concurrente puede entrar entre el conteo
y el `UPDATE` y dejar saldo huérfano igual.

Cambiar esa lectura a un `select` con bloqueo **compartido** sobre la fila de la faena.
Compartido y no exclusivo a propósito: los movimientos siguen corriendo en paralelo
entre sí (no serializa las recepciones masivas) y sólo el cierre, que pide el lock
exclusivo, espera a que terminen.

### 1.4 Tests

En `lib/__tests__/worksite-lifecycle.test.ts` (ya existe, no crear archivo nuevo):

- cerrar faena con saldo > 0 → rechaza, y **nada** quedó cancelado (CAPA y
  obligaciones intactas: verificar el rollback, no sólo el throw);
- cerrar faena con saldo 0 → pasa;
- filas de `worksite_stock` con `quantity = 0` no bloquean (son historial, no
  existencias);
- reactivar no ejecuta el guard.

---

## Fase 2 — Dejar de contar lo que nadie puede tocar ✅

El saldo de una faena cerrada hoy sigue disparando alertas de stock bajo mínimo que
nadie puede resolver, incluido el badge del sidebar.

- `getStockAlerts` ([lib/services/stock-alerts.ts:48](lib/services/stock-alerts.ts#L48)):
  agregar `worksites.isActive = true` al `where` — el join ya está.
- `getCriticalStockAlertCount` ([lib/services/stock-alerts.ts:86](lib/services/stock-alerts.ts#L86)):
  ni siquiera joina `worksites`. Agregar el `innerJoin` y el mismo filtro.
- `exportStock` ([lib/services/stock-export.ts:62](lib/services/stock-export.ts#L62)):
  es la foto de existencias de hoy → filtrar activas.
- `exportMovements` ([lib/services/stock-export.ts:149](lib/services/stock-export.ts#L149)):
  es kardex histórico → **no** tocar. Un movimiento pasado de una faena hoy cerrada es
  información válida.

Casos en `lib/__tests__/stock-alerts.test.ts`: una faena inactiva bajo mínimo no
aparece en la lista ni suma al contador.

**Hallazgo extra durante la implementación:** `getCriticalStockAlertCount` devolvía
`count(*)` sin castear. PGlite lo entrega como número y por eso los tests pasaban, pero
node-postgres devuelve `bigint` como **string**: en producción el badge del sidebar
recibía `"3"`, no `3`. Corregido a `count(*)::int`, que es la convención del resto del
repo.

---

## Fase 3 — La salida: devolver el saldo a Oficina ✅ (3b)

Vaciar una faena con entregas ficticias, desechos o ajustes de egreso también destraba
el cierre, pero deja escrito en el kardex algo que no ocurrió: el material volvió a
Oficina. Se implementó **3b**; 3a (guía de despacho interna en sentido inverso) queda
descartada por ahora — es un módulo entero para un caso que sólo aparece al cerrar.

**Cómo quedó:** el diálogo de cierre trae una casilla **"Devolver el saldo a Oficina"**
(marcada por defecto). `setWorksiteActive` recibe `returnStockToOffice` y, en la **misma
transacción y antes del guard**, recorre el saldo y emite por producto las dos patas de
kardex que ya usa la guía interna: `egreso_traslado` en la faena e `ingreso_traslado` en
la Oficina que resuelve `resolveOfficeWorksite`. Si el cierre falla después, el material
no se movió.

**Decisiones que vale la pena recordar:**

- **Permiso aparte.** Devolver saldo mueve inventario real, y `admin:worksites` no
  autoriza eso: la casilla sólo se muestra y sólo se acepta con `warehouse:adjust_stock`.
  Quien no lo tenga pide a bodega que vacíe la faena y después la cierra.
- **`FOR UPDATE` al leer el saldo.** Sin el lock, una recepción concurrente cambia la
  cantidad entre la lectura y el movimiento, y el traslado se emite por un saldo que ya
  no existe.
- **El diálogo dejó de cerrarse al enviar.** Cerraba en el `onClick`, así que un rechazo
  del servidor dejaba al usuario con un toast de error y sin el formulario que debía
  corregir. Ahora se cierra sólo cuando el cierre ocurrió (`toggleState.ok`), para lo
  cual `useCatalogSheet` expone `toggleState`.
- **La Oficina no puede devolverse el saldo a sí misma**: se rechaza explícitamente.

---

## Fase 4 — Regularizar lo que ya está huérfano ❌ no aplica

La Fase 0 en producción devolvió 0 filas: no hay saldo atrapado que regularizar.

Si alguna vez aparece (una faena cerrada antes de este cambio, restaurada de un
respaldo), el procedimiento por faena es:

1. Reactivar la faena.
2. Volver a cerrarla con la casilla **"Devolver el saldo a Oficina"** marcada y el
   motivo original.

Queda todo en `audit_log` y en el kardex de ambas bodegas.

---

## Estado

| Fase | Qué resuelve | Estado |
| --- | --- | --- |
| 0 | Saber si hay huérfanos hoy | ✅ 0 filas en dev y en producción |
| 1 | Impide crear el problema | ✅ |
| 2 | Alertas y export dejan de mentir | ✅ |
| 3 | Salida operativa sin reactivar | ✅ (3b; 3a descartada) |
| 4 | Limpia lo existente | ❌ no aplica (nada que regularizar) |

**Verificación:** `tsc --noEmit` limpio, eslint limpio, `check:drizzle-aliases` ok,
suite non-PGlite 4182 tests en verde, suite PGlite 710 tests en verde.

### Archivos tocados

- `lib/services/worksite-lifecycle.ts` — guard de saldo + devolución a Oficina
- `lib/services/stock-movement.ts` — lock compartido sobre la faena
- `lib/services/stock-alerts.ts`, `lib/services/stock-export.ts` — filtro de faena activa
- `app/(app)/admin/faenas/actions.ts`, `faenas-list.tsx`, `page.tsx` — casilla, permiso y
  manejo del rechazo
- `components/admin/use-catalog-sheet.ts` — expone `toggleState`
- `scripts/diagnose-orphan-stock.ts` + `npm run db:diagnose-orphan-stock`
- Tests: `worksite-lifecycle.test.ts`, `stock-alerts.test.ts`, `faenas-actions.test.ts`,
  `stock-movement.test.ts`
