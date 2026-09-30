import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return <div className="space-y-3 px-4 py-3 md:px-8"><Skeleton className="h-8 w-72" /><Skeleton className="h-10 w-full" /><Skeleton className="h-96 w-full" /></div>
}
