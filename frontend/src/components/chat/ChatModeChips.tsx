import * as React from "react";
import { PenLine, Mic2, Globe, Layers, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatModeChipId = "drafting" | "rhetorics" | "fast" | "deep" | "council";

export interface ChatModeChip {
  id: ChatModeChipId;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

export const CHAT_MODE_CHIPS: ReadonlyArray<ChatModeChip> = [
  {
    id: "drafting",
    label: "Drafting",
    description: "Draft speeches, clauses, and working papers using archive context.",
    icon: PenLine,
    color: "#22c55e",
  },
  {
    id: "rhetorics",
    label: "Rhetorics",
    description: "Build speeches, POIs, rebuttals, and floor interventions.",
    icon: Mic2,
    color: "#8b5cf6",
  },
  {
    id: "fast",
    label: "Fast Research",
    description: "Quick web lookups and fact-checking during committee sessions.",
    icon: Globe,
    color: "#3b6fd4",
  },
  {
    id: "deep",
    label: "Deep Research",
    description: "Comprehensive synthesis targeting 20-30 cited sources.",
    icon: Layers,
    color: "#3b6fd4",
  },
  {
    id: "council",
    label: "Council",
    description: "Six specialist councillors stress-test the agenda and prepare floor strategy.",
    icon: Users,
    color: "#d4a03b",
  },
];

export interface ChatModeChipsProps {
  activeId: ChatModeChipId;
  onSelect: (id: ChatModeChipId) => void;
  className?: string;
}

export function ChatModeChips({ activeId, onSelect, className }: ChatModeChipsProps) {
  return (
    <div
      role="tablist"
      aria-label="Chat mode"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto",
        className,
      )}
    >
      {CHAT_MODE_CHIPS.map((chip) => {
        const Icon = chip.icon;
        const active = chip.id === activeId;
        return (
          <button
            key={chip.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onSelect(chip.id)}
            className={cn(
              "group/chip relative flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60",
              active
                ? "border-amber-400/70 bg-amber-400/10 text-amber-100 shadow-[0_0_0_1px_rgba(212,160,59,0.18)]"
                : "border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05] hover:text-zinc-100",
            )}
            data-testid={`composer-chip-${chip.id}`}
            title={chip.description}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full transition-all",
                active ? "shadow-[0_0_8px_2px_rgba(212,160,59,0.55)]" : "opacity-60",
              )}
              style={{ backgroundColor: active ? "#d4a03b" : chip.color }}
              aria-hidden
            />
            <Icon
              className="h-3 w-3 shrink-0"
              style={{ color: active ? "#d4a03b" : chip.color }}
              aria-hidden
            />
            <span className="whitespace-nowrap">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
