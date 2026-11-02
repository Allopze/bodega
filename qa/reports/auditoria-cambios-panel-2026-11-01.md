# Auditoría de los cambios del Panel operacional

**Fecha:** 2026-11-01
**Alcance:** cambios propios de las fases 1–8 en `control-operacional`, servicios, export y navegación.
**Resultado:** 7 defectos corregidos; quedan riesgos de verificación y oportunidades de producto.

## Defectos encontrados y corregidos

1. **El downtime incluía OT canceladas.** La suma de “Horas de detención” no filtraba `status`; una OT cancelada con ventana de detención inflaba el total. Se agregó `status <> 'cancelled'` y una OT cancelada de 120 h al PGlite de estado como regresión.
2. **CAPA vencidas se podía duplicar.** Una misma CAPA referenciada por dos hallazgos se contaba dos veces. Se cambió a `COUNT(DISTINCT capa.id)` y se agregó un segundo hallazgo con la misma CAPA al PGlite.
3. **El aviso de estado se mostraba sin `flota:view`.** Un usuario de mantención o combustible podía ver el `Callout` “estado distinto” y un enlace a `/flota` que no podía abrir. El aviso quedó condicionado a `canViewFleet`.
4. **El E2E de combustible usaba índices fijos.** Al agregar columnas en fases posteriores, las celdas 4/5/11 dejaron de ser litros/rendimiento/costo. Ahora el test resuelve el índice por encabezado, por lo que no se rompe al reordenar columnas.
5. **La tarjeta móvil elegía el odómetro GPS para equipos por horómetro.** Mostraba una lectura potencialmente vacía o incorrecta. Ahora muestra odómetro y horómetro por separado, y el export ya tenía ambas columnas.
6. **Disponibilidad podía superar 100%.** Intervalos históricos solapados podían producir un porcentaje mayor a 100. Se acota a 100, igual que la cobertura, y se agregó prueba unitaria.
7. **La tarjeta de fuentes decía “Sin fuentes visibles” en un fallo total.** El servicio devuelve una fuente pendiente con `total: 0`; la etiqueta ahora prioriza “1 de 1 con pendientes” y deja el problema visible.

Además, la consulta de telemetría GPS se envolvió en `settleAttention`: una falla de GPS ya no tumba el panel entero; los campos quedan vacíos y el error se registra.

## Riesgos y oportunidades que quedan

- **Densidad de la tabla.** Suma vencimiento, GPS, SLA, responsable, plan y costo aprobado. No se ha verificado en navegador a 375/768/1440 px; si el scroll es incómodo, la salida correcta es una vista de detalle, no ocultar dimensiones.
- **Fallos silenciosos de documentos.** Si la consulta de documentos falla, `nextExpiryDate` queda vacío sin una señal de degradación explícita; el tile de atención sí queda en `null`.
- **Conciliación no periódica.** Los conteos de `unmatched`/`ambiguous` son del estado actual, no del período del panel; el texto de la tarjeta no lo distingue.
- **Etiqueta de cargas por decidir.** La tabla cuenta las cargas marcadas del período; el tile cuenta todas las pendientes. La columna no dice “del período”.
- **CAPA vinculada a hallazgo cerrado.** La consulta no filtra el estado del hallazgo; una CAPA abierta/vencida sigue contando aunque el hallazgo esté cerrado. Es una decisión de negocio pendiente.
- **Rendimiento promedio sin ponderar.** El rendimiento por activo es el promedio simple de cargas válidas, no ponderado por litros; el glosario lo dice, pero puede inducir a error.
- **Costo del panel.** Cada carga consulta 7 fuentes, documentos, GPS, inspecciones, CAPA, planes y combustible. No se midió el tiempo de respuesta ni el número de consultas.
- **Fase 6 incompleta por decisión.** Quedan deferidos el flag de discrepancia GPS ↔ lectura de carga y el motor en vacío por activo.
- **Suite rápida completa.** Sigue bloqueada por `React.act is not a function` en pruebas de componentes ajenas al panel; las pruebas focalizadas pasan.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Verde |
| `npm run lint` | Verde |
| `git diff --check` | Sin errores |
| PGlite de las fases 1–6 | 19/19 |
| Unitarias del panel/export/hub/fuentes/navegación | 102/102 |
| E2E/navegador | No ejecutado; requiere base desechable |

## Archivos tocados por la auditoría

`lib/services/operational-control.ts`, `app/(app)/control-operacional/page.tsx`, `app/(app)/control-operacional/operational-assets-table.tsx`, `e2e/control-operacional-combustible.spec.ts` y las pruebas PGlite/unitarias del panel.
