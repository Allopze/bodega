/**
 * Regla pura para códigos de capacidades de trabajadores.
 *
 * La validación también se ejecuta en formularios cliente. El generador de
 * códigos vive en `services/worker-positions/normalization.ts` y usa
 * `node:crypto`, así que esta regla no debe depender de ese módulo.
 */
export const WORKER_CAPABILITY_CODE_PATTERN = /^[a-z][a-z0-9_]{1,79}$/

