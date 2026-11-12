/**
 * Compatibilidad: el contrato de cron de OnWay es el mismo de todos los crons
 * de GPS de flota. La implementación vive en `fleet-gps/cron-contract.ts`.
 */
export type { FleetGpsCronOutcome as OnwayCronOutcome } from "../fleet-gps/cron-contract"
export { fleetGpsCronContractFor as onwayCronContractFor } from "../fleet-gps/cron-contract"
