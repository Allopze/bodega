import type { WorkerOption } from "./nueva-evaluacion-form.types"

export function resolveSelectedWorkerWorksite(
  workers: Pick<WorkerOption, "id" | "worksiteId">[],
  workerId: string,
  currentWorksiteId: string,
) {
  return workers.find((worker) => worker.id === workerId)?.worksiteId ?? currentWorksiteId
}
