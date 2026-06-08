import * as React from "react";
import { SlidersHorizontal, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatModeChips, type ChatModeChipId } from "./ChatModeChips";
import { ChatInputBox, type ChatInputBoxHandle } from "./ChatInputBox";
import { ChatComposerActions } from "./ChatComposerActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ChatComposerProps {
  // Input state
  input: string;
  onInputChange: (next: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onEnhance: () => void;

  // Options / streaming
  onShowOptionsToggle?: () => void;
  showOptions?: boolean;
  isStreaming: boolean;
  isEnhancing: boolean;
  disabled?: boolean;

  // Modes
  activeChip: ChatModeChipId;
  onSelectChip: (id: ChatModeChipId) => void;
  placeholder: string;

  // Optional overlays
  enhancedNotice?: { original: string; onRestore: () => void } | null;
  researchProviderUnavailable?: boolean;
  showOptionsToggle?: boolean;
  statusBadge?: { label: string; color: string; bg: string; border: string } | null;
  modelSummary?: string;

  // External focus handle
  focusRef?: React.MutableRefObject<(() => void) | null>;

  className?: string;
}

export function ChatComposer({
  input,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onEnhance,
  onShowOptionsToggle,
  showOptions,
  isStreaming,
  isEnhancing,
  disabled,
  activeChip,
  onSelectChip,
  placeholder,
  enhancedNotice,
  researchProviderUnavailable,
  showOptionsToggle = true,
  statusBadge,
  modelSummary,
  focusRef,
  className,
}: ChatComposerProps) {
  const inputRef = React.useRef<ChatInputBoxHandle | null>(null);

  React.useImperativeHandle(
    focusRef,
    () => () => {
      inputRef.current?.focus();
    },
    [],
  );

  return (
    <div
      className={cn(
        "pointer-events-auto relative w-full",
        className,
      )}
    >
      {/* Overlays above the composer */}
      {enhancedNotice && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#3b6fd430] bg-[#3b6fd414] px-3 py-2 text-xs text-[#a8b9e8] animate-in slide-in-from-top-1">
          <div className="flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5 shrink-0" />
            <span>Prompt enhanced —{" "}
              <button onClick={enhancedNotice.onRestore} className="underline hover:no-underline">
                restore original
              </button>
            </span>
          </div>
        </div>
      )}
      {researchProviderUnavailable && (
        <div className="mb-2 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200 backdrop-blur-xl">
          Configure provider keys before running research or web search.
        </div>
      )}

      {/* Floating rounded panel */}
      <div
        className={cn(
          "rounded-[24px] border border-amber-500/30 bg-zinc-950/80 backdrop-blur-2xl",
          "shadow-[0_10px_28px_-10px_rgba(0,0,0,0.55),0_0_0_1px_rgba(212,160,59,0.10),0_0_24px_-6px_rgba(212,160,59,0.22)]",
          "ring-1 ring-inset ring-white/[0.04]",
          "transition-shadow",
        )}
        data-testid="chat-composer-panel"
      >
        {/* Top row: mode chips + options toggle */}
        <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5">
          <ChatModeChips activeId={activeChip} onSelect={onSelectChip} />
          {showOptionsToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onShowOptionsToggle}
                  aria-label={showOptions ? "Hide model options" : "Show model options"}
                  className={cn(
                    "ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60",
                    showOptions
                      ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                      : "border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05] hover:text-zinc-100",
                  )}
                  data-testid="button-composer-options-toggle"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{showOptions ? "Hide model options" : "Model options"}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Optional status / model summary row */}
        {(statusBadge || modelSummary) && (
          <div className="flex items-center gap-2 px-3 pb-1 text-[10px] text-zinc-400">
            {statusBadge && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                  statusBadge.color,
                  statusBadge.bg,
                  statusBadge.border,
                )}
              >
                {statusBadge.label}
              </span>
            )}
            {modelSummary && <span className="truncate">{modelSummary}</span>}
          </div>
        )}

        {/* Middle: textarea */}
        <div className="px-1.5">
          <div className="relative">
            <ChatInputBox
              ref={inputRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={disabled || isStreaming}
            />
          </div>
        </div>

        {/* Bottom: keyboard hint + actions */}
        <div className="flex items-center justify-between gap-2 px-2.5 pt-0.5 pb-1.5">
          <span className="hidden min-w-0 items-center gap-1.5 truncate text-[10px] text-[#6b6b82] sm:inline-flex">
            <kbd className="rounded bg-white/[0.04] px-1 py-0.5 font-mono text-[10px] text-zinc-300">Enter</kbd>
            to send ·
            <kbd className="rounded bg-white/[0.04] px-1 py-0.5 font-mono text-[10px] text-zinc-300">Shift+Enter</kbd>
            for newline
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[#6b6b82] sm:hidden">
            <Wand2 className="h-3 w-3" />
            Tap to enhance
          </span>
          <ChatComposerActions
            value={input}
            isStreaming={isStreaming}
            isEnhancing={isEnhancing}
            disabled={disabled}
            onSend={onSend}
            onStop={onStop}
            onEnhance={onEnhance}
            className="ml-auto"
          />
        </div>
      </div>
    </div>
  );
}
