import type { CorePipelineEventSummary } from "@/hooks/use-pipeline-state";
import { collectRetrievalCacheStats } from "./useRetrievalCacheStats";

interface RetrievalCachePanelProps {
  events?: CorePipelineEventSummary[];
}

export function RetrievalCachePanel({ events = [] }: RetrievalCachePanelProps) {
  const stats = collectRetrievalCacheStats(events);
  if (stats.summaries.length === 0 && stats.cooldowns.length === 0 && stats.warnings.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-background/70 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground">Retrieval Cache</p>
        <p className="text-[10px] text-muted-foreground">
          {stats.totalHits} hit / {stats.totalMisses} miss{stats.totalNegativeHits ? ` / ${stats.totalNegativeHits} negative` : ""}
        </p>
      </div>
      {stats.summaries.length > 0 && (
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {stats.summaries.slice(0, 6).map((summary) => (
            <p key={summary.layer} className="truncate text-[10px] text-muted-foreground">
              {summary.layer.replace(/_/g, " ")}: {summary.hits}/{summary.misses}
              {summary.negativeHits ? ` n${summary.negativeHits}` : ""}
            </p>
          ))}
        </div>
      )}
      {stats.cooldowns.length > 0 && (
        <p className="mt-1 line-clamp-2 text-[10px] text-amber-700 dark:text-amber-300">
          Cooldown: {stats.cooldowns.join("; ")}
        </p>
      )}
      {stats.warnings.length > 0 && (
        <p className="mt-1 line-clamp-2 text-[10px] text-red-700 dark:text-red-300">
          {stats.warnings.join("; ")}
        </p>
      )}
    </div>
  );
}
