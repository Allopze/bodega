# QA de implementación — revisión PDTP v+1

Fecha: 2026-09-16  
Entorno: desarrollo local, Next.js en `http://127.0.0.1:3001`, sesión QA autenticada.

## Resultado

La validación determinista del cambio pasó. La validación visual autenticada del módulo quedó incompleta: la sesión QA disponible fue redirigida desde `/prevencion/pdtp` a `/dashboard`, por lo que no tenía autorización efectiva para recorrer el programa preventivo ni producir capturas de sus estados nuevos.

## Pruebas ejecutadas

| Alcance | Resultado |
| --- | --- |
| Tipos | `npm run typecheck` pasó. |
| Lint | `npm run lint` pasó sin errores ni advertencias. |
| Migraciones | `npm run db:verify-migrations` pasó: 301 entradas hasta `0300_nifty_namorita`. |
| Servicios PDTP | PGlite focal: 3 archivos, 191 pruebas aprobadas. Incluye cobertura, acreditación, ciclo de programa y creación concurrente de revisión v+1. |
| Panel de cobertura | Vitest de interfaz: 5 pruebas aprobadas. |
| React Doctor | 87/100 sobre archivos cambiados. La sincronización URL/sessionStorage del editor fue revisada como intencional; las tres advertencias de complejidad están en pantallas preexistentes. |

## Recorrido de navegador

- Ruta solicitada: `/prevencion/pdtp`, en escritorio 1440×1000 y móvil 390×844.
- Resultado real: ambas visitas terminaron en `/dashboard`; no se abrió el tablero ni detalle PDTP.
- Errores de consola: ninguno.
- Fallas de red: dos solicitudes al avatar externo DiceBear bloqueadas por ORB. Es el warning externo de avatar excluido del alcance PDTP.
- Capturas de evidencia de la redirección:
  - `capturas/acceso-redireccion-desktop.png`
  - `capturas/acceso-redireccion-movil.png`

## Cobertura pendiente

Queda pendiente una sesión QA con `prevention:pdtp:program:read` y `prevention:pdtp:program:manage` para revisar visualmente:

- CTA de crear revisión v+1 y linaje v1 → v2.
- Cobertura con ejecutor pendiente, ejecutor sin permiso y flujo segregado válido.
- Decisiones por diferencia frente a la Base vigente.
- Estado sin ejecuciones, ranking de categorías, totales Plan / ejecutado y pista de desplazamiento móvil.

No se modificaron permisos, programas activos, ejecuciones ni datos históricos para forzar ese recorrido.
