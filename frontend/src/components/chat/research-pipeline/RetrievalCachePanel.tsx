import type { CorePipelineEventSummary } from "@/hooks/use-pipeline-state";
import { collectRetrievalCacheStats } from "./useRetrievalCacheStats";

interface RetrievalCachePanelProps {
  events?: CorePipelineEventSummary[];
}

export function RetrievalCachePanel({ events = [] }: RetrievalCachePanelProps) {
  const stats = collectRetrievalCacheStats(events);
  
  // Only show panel if there are actual cache hits/misses to report
  // Hide internal details like cooldowns and warnings - those are backend logs only
  if (stats.totalHits === 0 && stats.totalMisses === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-background/70 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground">Retrieval Cache</p>
        <p className="text-[10px] text-muted-foreground">
          {stats.totalHits} hit / {stats.totalMisses} miss
        </p>
      </div>
      {stats.summaries.length > 0 && (
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {stats.summaries.slice(0, 6).map((summary) => (
            <p key={summary.layer} className="truncate text-[10px] text-muted-foreground">
              {summary.layer.replace(/_/g, " ")}: {summary.hits}/{summary.misses}
            </p>
          ))}
        </div>
      )}
      {/* Removed cooldown and warning displays - these are internal backend logs */}
    </div>
  );
}
