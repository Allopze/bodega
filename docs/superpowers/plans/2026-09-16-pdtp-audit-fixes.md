# Plan de fixes de auditoría PDTP — 2026-09-16

## Objetivo

Corregir los hallazgos confirmados de la auditoría del programa preventivo sin suspender el programa activo ni alterar su evidencia. El lote se implementa completo antes de ejecutar pruebas, tal como solicitó el usuario.

## Alcance de implementación

1. Mantener compatibilidad de huellas firmadas al evolucionar el snapshot, incorporando `mechanism` en la versión nueva y seleccionando la versión almacenada al verificar digest.
2. Hacer que reconciliación y preflight respeten la identidad año + versión y elijan de forma determinista el programa operativo.
3. Comparar diferencias de revisión por actividad y contenido asociado; permitir aplicar también planificación, ejecutores, checklists, vínculos, exclusiones, parámetros y overrides, sin aplicar nada automáticamente.
4. Separar la vista de una v1 de la comparación de revisión v+1.
5. Corregir estados de cobertura, permisos legibles y CTAs contextuales; sustituir estados de operación locales por `useOperation`.
6. Corregir el tablero para que cada visualización use su propio estado de ejecuciones y mostrar la versión en listas y selectores.
7. Validar decisiones de diferencias en runtime.

## Validación final (una sola ronda)

Después de completar todas las ediciones: typecheck, lint, cadena de migraciones, tests focalizados PDTP/PGlite/UI, `git diff --check` y cualquier verificación de navegador disponible. Se reportarán explícitamente los recorridos no alcanzados.
