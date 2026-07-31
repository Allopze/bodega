/**
 * Dashboard data-loading helpers — barrel.
 *
 * Re-exports from:
 *   - dashboard-metrics.ts     (getDashboardData, DashboardData, MetricKey)
 *
 * `getWorkQueueSnapshot` vivía aquí y alimentaba al `buildWorkTasks` de
 * `lib/work-queue-builders.ts`; ninguna pantalla usaba ese camino —la cola, el
 * dashboard y los badges leen `operational-work-queue.ts`—, así que se eliminó.
 */

export { getDashboardData } from "./dashboard-metrics"
export type {
  DashboardData,
  MetricKey,
} from "./dashboard-metrics"
