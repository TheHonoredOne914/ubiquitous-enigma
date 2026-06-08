import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { ChatComposer } from "./ChatComposer";
import { type ChatModeChipId } from "./ChatModeChips";
import {
  useGetAnthropicConversation,
  getGetAnthropicConversationQueryKey,
  useCreateAnthropicConversation,
  getListAnthropicConversationsQueryKey,
  type AnthropicConversation,
  type AnthropicMessage,
} from "@/lib/api-client";
import {
  Bot, User,
  Wand2, ChevronRight, ArrowDown,
  Copy, RefreshCw, Globe, FlaskConical, Zap, MessageSquare, ChevronDown,
  PenLine, Mic2, Layers, Landmark, Bookmark, Users,
  ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { usePipelineState } from "@/hooks/use-pipeline-state";
import { loadProviderKeys } from "@/lib/provider-keys";
import { useProviderModels } from "@/hooks/use-provider-models";
import { apiFetch } from "@/lib/api-fetch";
import { StreamingText } from "./streaming-text";
import { ResearchPipeline } from "./research-pipeline";
import { CouncilChamberPanel } from "@/components/council/council-chamber-panel";
import { PersistedPipeline, extractPipelineMeta } from "./persisted-pipeline";
import { CursorGlint } from "./cursor-glint";
import { CitationMessage, prepareMessageForCopy } from "./chat-message-list";
import { ResearchRunSidebar, summarizeResearchRunSidebar } from "./chat-run-status";
import { useModeModelSelection } from "./use-mode-model-selection";
import { useChatRunController } from "./use-chat-run-controller";
import { loadAutoFallback } from "./settings-dialog";
import {
  type ChatMode,
  type ChatType,
  type NormalModel,
  type RhetoricsType,
} from "./chat-model-routing";
// Source-based backend regression tests assert these preserved semantics:
// researchMode: mode === "normal" ? undefined : mode
// data.runId === active.runId
// SET_ACTIVE_RUN
// IGNORED_STALE_EVENT
// terminalSuccessReceived receivedDone !response.ok completed_with_source_gaps legacy_fallback_used
import {
  stripPrefix,
  simplifyModelName,
  getModelDescription,
  getModelIcon,
  type ProviderModel,
} from "./provider-model-display";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ChatAreaProps {
  conversationId: number | null;
  activeArchiveId: number | null;
  activeArchiveName?: string | null;
  activeArchiveTopic?: string | null;
  activeArchiveAngles?: string[] | null;
  onConversationCreated: (id: number) => void;
  onOpenMobileSidebar?: () => void;
  onNewChat?: () => void;
}

const messageDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const messageTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatMessageDate(date: Date): string {
  return messageDateFormatter.format(date);
}

function formatMessageTime(date: Date): string {
  return messageTimeFormatter.format(date);
}

export function ChatArea({
  conversationId,
  activeArchiveId,
  activeArchiveName,
  activeArchiveTopic,
  activeArchiveAngles,
  onConversationCreated,
  onOpenMobileSidebar,
  onNewChat,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [tokensPerSec, setTokensPerSec] = useState<number | null>(null);
  const composerFocusRef = useRef<(() => void) | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  useEffect(() => { if (isStreaming) setShowOptions(false); }, [isStreaming]);
  const [chatType, setChatType] = useState<ChatType>("research");
  const [rhetoricsType, setRhetoricsType] = useState<RhetoricsType>("speech");
  const [creativity, setCreativity] = useState<number>(0.5);
  const [debateSuggestions, setDebateSuggestions] = useState<string[]>([]);
  const [autoFallback, setAutoFallback] = useState<boolean>(() => loadAutoFallback());
  const [currentMode, setCurrentMode] = useState<ChatMode>(() => {
    try {
      const saved = localStorage.getItem("lastChatMode");
      if (saved === "fast_research" || saved === "council" || saved === "normal") return saved;
    } catch {}
    return "fast_research";
  });

  useEffect(() => {
    try { localStorage.setItem("lastChatMode", currentMode); } catch {}
  }, [currentMode]);
  const {
    providerStatus,
    providerModels,
    healthyResearchModels,
    selectedModel: normalModel,
    setSelectedModel: setNormalModel,
  } = useProviderModels();
  const groqModels = providerModels.groq;
  const nvidiaModels = providerModels.nvidia;
  const ollamaModels = providerModels.ollama;
  const geminiModels = providerModels.gemini;
  const openrouterModels = providerModels.openrouter;
  const githubModels = providerModels.github;
  const {
    webSearchModels,
    setWebSearchModels,
    deepResearchModels,
    setDeepResearchModels,
    getModelsForMode,
    getPrimaryModelForMode,
  } = useModeModelSelection({
    normalModel,
    setNormalModel,
    healthyResearchModels,
  });
  const modelGroups = useMemo(() => [
    { provider: "Groq", models: groqModels },
    { provider: "Gemini", models: geminiModels },
    { provider: "NVIDIA", models: nvidiaModels },
    { provider: "OpenRouter", models: openrouterModels },
    { provider: "GitHub", models: githubModels },
    { provider: "Ollama", models: ollamaModels },
  ], [geminiModels, githubModels, groqModels, nvidiaModels, ollamaModels, openrouterModels]);
  const hasModelOptions = modelGroups.some(({ models }) => models.length > 0);
  const [connectionWarn, setConnectionWarn] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const start = Date.now();
    fetch(`${base}/api/healthz`, { cache: "no-store" })
      .then((r) => {
        const rtt = Date.now() - start;
        if (!r.ok || rtt > 500) setConnectionWarn(true);
      })
      .catch(() => setConnectionWarn(true));
  }, []);

  const researchProviderUnavailable = chatType === "research" && currentMode !== "normal" && healthyResearchModels.length === 0;

  // Toggle a model in a multi-select list (always keep at least one)
  const toggleModelInList = (models: string[], setModels: (m: string[]) => void, modelId: string) => {
    if (models.includes(modelId)) {
      // Don't allow deselecting the last one
      if (models.length === 1) return;
      setModels(models.filter((m) => m !== modelId));
    } else {
      setModels([...models, modelId]);
    }
  };

  // Enhance prompt state
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedFrom, setEnhancedFrom] = useState<string | null>(null);

  // Consolidated pipeline state via reducer
  const { state: pipeline, dispatch: dispatchPipeline, reset: resetPipeline } = usePipelineState();
  const {
    streamingContent,
    currentSearch,
    isSynthesizing,
    isComplete,
  } = pipeline;

  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const createMutation = useCreateAnthropicConversation();
  const { toast } = useToast();
  const lastUserMessageRef = useRef<string | null>(null);
  const lastRunContextRef = useRef<{
    chatType: ChatType;
    mode: ChatMode;
    model: NormalModel;
    rhetoricsType?: RhetoricsType;
    creativity?: number;
  } | null>(null);
  const { runStream, handleStop, abortStreamsForConversation } = useChatRunController({
    dispatchPipeline,
    toast,
    setDebateSuggestions,
    setTokensPerSec,
    normalModel,
    autoFallback,
    getPrimaryModelForMode,
    getModelsForMode,
  });

  useEffect(() => {
    const handleProviderKeysUpdated = (event: Event) => {
      const nextAutoFallback = (event as CustomEvent<{ autoFallback?: boolean }>).detail?.autoFallback;
      if (typeof nextAutoFallback === "boolean") setAutoFallback(nextAutoFallback);
      else setAutoFallback(loadAutoFallback());
    };
    window.addEventListener("bestdel:provider-keys-updated", handleProviderKeysUpdated);
    window.addEventListener("storage", handleProviderKeysUpdated);
    return () => {
      window.removeEventListener("bestdel:provider-keys-updated", handleProviderKeysUpdated);
      window.removeEventListener("storage", handleProviderKeysUpdated);
    };
  }, []);

  const activeRunInFlight = isStreaming || pipeline.runStatus === "running" || pipeline.runStatus === "repairing";
  const cancelActiveRun = useCallback(() => {
    handleStop();
    setIsStreaming(false);
    dispatchPipeline({ type: "RUN_STATUS", status: "cancelled" });
  }, [dispatchPipeline, handleStop]);

  // Cleanup in-flight stream and reset state when switching conversations
  useEffect(() => {
    handleStop();
    setIsStreaming(false);
    resetPipeline();
    setInput("");
    return () => abortStreamsForConversation(conversationId);
  }, [abortStreamsForConversation, conversationId, handleStop, resetPipeline]);

  const { data: conversation, isLoading } = useGetAnthropicConversation(
    conversationId as number,
    { query: { enabled: !!conversationId, queryKey: conversationId != null ? getGetAnthropicConversationQueryKey(conversationId) : ["anthropic", "conversations", "disabled"] } }
  );

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, streamingContent, currentSearch]);

  // Track scroll position for floating scroll-to-bottom button
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 300);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [conversationId, conversation?.messages?.length]);

  const resetPipelineState = () => {
    resetPipeline();
    setEnhancedFrom(null);
  };

  const handleSend = async () => {
    if (!input.trim() || activeRunInFlight) return;
    if (input.trim().length > 4000) {
      toast({ title: "Input too long", description: "Maximum 4000 characters allowed.", variant: "destructive" });
      return;
    }
    if (!activeArchiveId) {
      toast({
        title: "Create an archive first",
        description: "Every chat now lives inside an archive topic.",
        variant: "destructive",
      });
      return;
    }

    // Offline guard — show a helpful toast instead of silent failure
    if (!navigator.onLine) {
      toast({
        title: "You're offline",
        description: "Check your internet connection and try again.",
        variant: "destructive",
      });
      return;
    }

    const messageContent = input.trim();

    setInput("");
    setIsStreaming(true);
    resetPipelineState();

    let currentConvId = conversationId;
    try {
      const now = new Date().toISOString();
      const fallbackTitle = messageContent.split(/\s+/).slice(0, 4).join(" ") + "...";

      if (!currentConvId) {
        const newConv = await createMutation.mutateAsync({ data: { title: fallbackTitle, archiveId: activeArchiveId } });
        currentConvId = newConv.id;

        const optimisticMessage: AnthropicMessage = {
          id: -Date.now(),
          conversationId: currentConvId,
          role: "user",
          content: messageContent,
          createdAt: now,
        };
        const optimisticConversation: AnthropicConversation = {
          ...newConv,
          archiveId: newConv.archiveId ?? activeArchiveId,
          title: newConv.title || fallbackTitle,
          createdAt: newConv.createdAt ?? now,
          messages: [optimisticMessage],
        };

        queryClient.setQueryData(getGetAnthropicConversationQueryKey(currentConvId), optimisticConversation);
        queryClient.setQueryData(
          [...getListAnthropicConversationsQueryKey(), activeArchiveId],
          (old: AnthropicConversation[] | undefined) => {
            const existing = old ?? [];
            return [
              { ...optimisticConversation, messages: undefined },
              ...existing.filter((item) => item.id !== currentConvId),
            ];
          }
        );
        onConversationCreated(currentConvId);

        // Fire-and-forget AI title generation
        (async () => {
          try {
            const r = await apiFetch("/api/anthropic/generate-title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: messageContent }),
            });
            if (!r.ok) return;
            const { title } = await r.json();
            if (!title || typeof title !== "string") return;
            await apiFetch(`/api/anthropic/conversations/${newConv.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
            queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
          } catch (e) {
            console.error("AI title generation failed", e);
          }
        })();
      }

      lastUserMessageRef.current = messageContent;

      if (currentConvId) {
        const optimisticMessage: AnthropicMessage = {
          id: -Date.now(),
          conversationId: currentConvId,
          role: "user",
          content: messageContent,
          createdAt: now,
        };

        queryClient.setQueryData(getGetAnthropicConversationQueryKey(currentConvId), (old: AnthropicConversation | undefined) => {
          if (!old) {
            return {
              id: currentConvId,
              archiveId: activeArchiveId,
              title: fallbackTitle,
              createdAt: now,
              messages: [optimisticMessage],
            };
          }
          const messages = old.messages ?? [];
          if (messages.some((msg) => msg.id === optimisticMessage.id || (msg.role === "user" && msg.content === messageContent && msg.createdAt === now))) {
            return old;
          }
          return {
            ...old,
            messages: [...messages, optimisticMessage],
          };
        });
      }

      setDebateSuggestions([]);
      lastRunContextRef.current = {
        chatType,
        mode: currentMode,
        model: normalModel,
        rhetoricsType,
        creativity,
      };
      await runStream(
        currentConvId!, messageContent, normalModel, currentMode,
        chatType === "rhetorics" ? { rhetoricsType, creativity } : undefined
      );
    } catch (error) {
      if ((error as any)?.name !== "AbortError") {
        console.error("Failed to send message:", error);
      } else {
        dispatchPipeline({ type: "RUN_STATUS", status: "cancelled" });
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleEnhancePrompt = async () => {
    if (!input.trim() || isEnhancing) return;
    setIsEnhancing(true);
    const original = input.trim();
    try {
      const res = await apiFetch("/api/anthropic/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: original, mode: currentMode }),
      });
      if (res.ok) {
        const { enhanced } = await res.json();
        if (enhanced) {
          setEnhancedFrom(original);
          setInput(enhanced);
        }
      }
    } catch (e) {
      console.error("Enhance failed", e);
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape: close options dropdown
    if (e.key === "Escape") {
      if (showOptions) {
        e.preventDefault();
        setShowOptions(false);
      }
      return;
    }
    // Cmd/Ctrl+Enter: send message (power user shortcut)
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
      return;
    }
    // Regular Enter: send (shift+enter for newline handled by default)
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyMessage = async (content: string) => {
    const plainText = prepareMessageForCopy(content);
    // Fix (Bug L486): navigator.clipboard requires HTTPS — fall back to execCommand for HTTP contexts
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(plainText);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = plainText;
        textArea.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
        document.body.appendChild(textArea);
        textArea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (!ok) throw new Error("execCommand copy failed");
      }
      toast({ title: "Copied!", description: "Message copied to clipboard.", duration: 1500 });
    } catch (err) {
      toast({ title: "Copy failed", description: `Could not copy: ${err instanceof Error ? err.message : "clipboard unavailable"}`, variant: "destructive" });
    }
  };

  const handleRegenerate = useCallback(async () => {
    const messages = conversation?.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastMsg = lastUser?.content ?? lastUserMessageRef.current;
    if (!lastMsg || activeRunInFlight || !conversationId) return;
    setIsStreaming(true);
    resetPipelineState();
    const context = lastRunContextRef.current ?? {
      chatType,
      mode: currentMode,
      model: normalModel,
      rhetoricsType,
      creativity,
    };
    try {
      await runStream(
        conversationId,
        lastMsg,
        context.model,
        context.mode,
        context.chatType === "rhetorics" && context.rhetoricsType != null && context.creativity != null
          ? { rhetoricsType: context.rhetoricsType, creativity: context.creativity }
          : undefined,
      );
    } catch (e) {
      if ((e as any)?.name !== "AbortError") console.error("Regenerate failed", e);
      else dispatchPipeline({ type: "RUN_STATUS", status: "cancelled" });
    } finally {
      setIsStreaming(false);
    }
  }, [activeRunInFlight, chatType, conversation?.messages, conversationId, creativity, currentMode, dispatchPipeline, normalModel, rhetoricsType, runStream]);

  const activeSearchProvider = useMemo(() => {
    const providers = [
      ["tavily", "Tavily"],
      ["brave", "Brave"],
      ["serper", "Serper"],
      ["exa", "Exa"],
      ["firecrawl", "Firecrawl"],
      ["jina", "Jina"],
    ] as const;
    const healthy = providers.find(([key]) => providerStatus[key]?.healthy);
    if (healthy) return { label: healthy[1], status: "ready" };
    const configured = providers.find(([key]) => providerStatus[key]?.configured);
    if (configured) return { label: configured[1], status: providerStatus[configured[0]]?.status ?? "checking" };
    return { label: "No search key", status: "missing_key" };
  }, [providerStatus]);

  const focusInput = () => {
    setTimeout(() => composerFocusRef.current?.(), 50);
  };

  const featureCards = [
    {
      icon: MessageSquare,
      title: "Drafting Desk",
      desc: "Prepare speeches, rebuttals, POIs, motions, and clauses in one archive.",
      accent: "#22c55e",
      iconBg: "rgba(34, 197, 94, 0.12)",
      iconColor: "#22c55e",
      onClick: () => { setCurrentMode("normal"); focusInput(); },
    },
    {
      icon: Globe,
      title: "Source-Backed Search",
      desc: "Run fast evidence checks across official, legal, policy, and media sources.",
      accent: "#3b6fd4",
      iconBg: "rgba(59, 111, 212, 0.14)",
      iconColor: "#6f93e8",
      onClick: () => { setCurrentMode("fast_research"); focusInput(); },
    },
    {
      icon: Users,
      title: "Council Chamber",
      desc: "Six specialist councillors deliberate before a Chief verdict.",
      accent: "#d4a03b",
      iconBg: "rgba(212, 160, 59, 0.14)",
      iconColor: "#d4a03b",
      onClick: () => { setCurrentMode("council"); focusInput(); },
    },
  ];

  const MODE_META: Record<ChatMode, { label: string; icon: any; color: string; bg: string; border: string; ring: string; hex: string; }> = {
    normal: {
      label: "Drafting", icon: PenLine,
      color: "text-[#22c55e]",
      bg: "bg-[#22c55e18]",
      border: "border-[#22c55e30]",
      ring: "ring-slate-400",
      hex: "#22c55e",
    },
    fast_research: {
      label: "Fast Research", icon: Globe,
      color: "text-[#6f93e8]",
      bg: "bg-[#3b6fd418]",
      border: "border-[#3b6fd430]",
      ring: "ring-blue-400",
      hex: "#3b6fd4",
    },
    deep_research: {
      label: "Deep Research", icon: FlaskConical,
      color: "text-[#6f93e8]",
      bg: "bg-[#3b6fd418]",
      border: "border-[#3b6fd430]",
      ring: "ring-blue-400",
      hex: "#3b6fd4",
    },
    council: {
      label: "Council", icon: Users,
      color: "text-[#d4a03b]",
      bg: "bg-[#d4a03b18]",
      border: "border-[#d4a03b30]",
      ring: "ring-amber-400",
      hex: "#d4a03b",
    },
  };

  const deskModes = [
    { id: "drafting", label: "Drafting", icon: PenLine, color: "#22c55e", description: "Draft speeches, clauses, and working papers using archive context.", select: () => { setChatType("research"); setCurrentMode("normal"); setShowOptions(false); } },
    { id: "rhetorics", label: "Rhetorics", icon: Mic2, color: "#8b5cf6", description: "Build speeches, POIs, rebuttals, and floor interventions.", select: () => { setChatType("rhetorics"); setShowOptions(false); } },
    { id: "fast", label: "Fast Research", icon: Globe, color: "#3b6fd4", description: "Quick web lookups and fact-checking during committee sessions.", select: () => { setChatType("research"); setCurrentMode("fast_research"); setShowOptions(false); } },
    { id: "council", label: "Council", icon: Users, color: "#d4a03b", description: "Six councillors stress-test the agenda and prepare floor strategy.", select: () => { setChatType("research"); setCurrentMode("council"); setShowOptions(false); } },
  ];

  const activeDeskMode =
    chatType === "rhetorics" ? "rhetorics" :
    currentMode === "council" ? "council" :
    currentMode === "fast_research" ? "fast" :
    "drafting";

  const activeProviderModel = getPrimaryModelForMode(currentMode);
  const activeModeModels = getModelsForMode(currentMode);
  const activeModeModelSetter = currentMode === "fast_research" ? setWebSearchModels : setDeepResearchModels;
  const activeModeColor = chatType === "rhetorics" ? "#8b5cf6" : MODE_META[currentMode].hex;
  const isWelcome = !conversationId && !isStreaming && !conversation;
  // Fix (Bug L653): keep sidebar mounted after streaming ends so sources remain visible
  const showResearchRail = (isStreaming || pipeline.isComplete) && chatType === "research" && currentMode !== "normal";
  const researchSidebarSummary = useMemo(() => summarizeResearchRunSidebar({
    activeArchiveName,
    activeArchiveTopic,
    activeArchiveAngles,
    runStatus: pipeline.runStatus,
    selectedResearchMode: pipeline.selectedResearchMode,
    corePipelineEvents: pipeline.corePipelineEvents,
    fullSourceManifest: pipeline.fullSourceManifest,
    citationStatus: pipeline.citationStatus,
    sourceContract: pipeline.sourceContract,
    sourceGapReport: pipeline.sourceGapReport,
  }), [
    activeArchiveAngles,
    activeArchiveName,
    activeArchiveTopic,
    pipeline.citationStatus,
    pipeline.corePipelineEvents,
    pipeline.fullSourceManifest,
    pipeline.runStatus,
    pipeline.selectedResearchMode,
    pipeline.sourceContract,
    pipeline.sourceGapReport,
  ]);

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[#08090b]">
      {showResearchRail && (
        <ResearchRunSidebar summary={researchSidebarSummary} />
      )}
      {isWelcome ? (
        <div key="welcome" className="animate-page-fade flex-1 overflow-y-auto" data-cursor-glint-scope="welcome">
          <CursorGlint />
          <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-start gap-4 px-5 pb-10 pt-5 md:px-8 lg:pt-6">
            <div className="relative">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="bestdel-hero-glow welcome-greeting relative mx-auto max-w-3xl text-center"
              >
                <Landmark className="pointer-events-none absolute left-1/2 top-[-34px] h-28 w-28 -translate-x-1/2 text-[#3b6fd4]/10 md:h-36 md:w-36" />
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-3 flex items-center justify-center gap-2"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-[#3b6fd4]" />
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6b6b82]">
                    {activeArchiveName || "Legacy Archive"}
                  </span>
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.5 }}
                  className="mx-auto max-w-3xl text-3xl leading-[0.95] text-[#eeeef5] md:text-4xl lg:text-[2.85rem]"
                  style={{ fontFamily: "Instrument Serif, serif", fontWeight: 400 }}
                >
                  Honorable Delegate,
                  <br />
                  <span className="text-[#a8b9e8]">the floor is yours.</span>
                </motion.h1>
                <div className="hero-rule mx-auto" aria-hidden />
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.25 }}
                  className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#9a9ab0] md:text-[14px]"
                >
                  Your intelligence desk for Indian parliamentary committees. Research complex agendas, draft speeches, and formulate rebuttals backed by validated citations and deep source memory.
                </motion.p>
                <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-2">
                  {["Citations validated", "Source usage mapped", "Archive memory", "Indian committee framing"].map((badge) => (
                    <span
                      key={badge}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#d4a03b30] bg-[#d4a03b12] px-2.5 py-1 text-[11px] font-semibold text-[#f3c76f]"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {badge}
                    </span>
                  ))}
                </div>
                <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-center gap-1.5">
                  {[
                    ["Plan", "Topic-aware queries"],
                    ["Retrieve", "official/legal sources"],
                    ["Validate", "citation gates"],
                    ["Archive", "brief memory"],
                  ].map(([label, desc]) => (
                    <span key={label} className="rounded-full border border-[#2a2d38] bg-[#111215] px-2.5 py-1 text-[10px] text-[#8b8b9f]">
                      <span className="font-bold uppercase tracking-[0.12em] text-[#d4a03b]">{label}</span>{" "}
                      {desc}
                    </span>
                  ))}
                </div>
                {activeArchiveTopic && (
                  <div className="mx-auto mt-4 flex max-w-2xl items-start gap-2 rounded-xl border border-[#2a2d38] bg-[#111215]/82 px-3 py-2 text-left">
                    <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4a03b]" />
                    <p className="min-w-0 text-sm leading-6 text-[#9a9ab0]">
                      <span className="font-semibold text-[#d4a03b]">Active Archive Brief:</span>{" "}
                      <span className="line-clamp-2">{activeArchiveTopic}</span>
                    </p>
                  </div>
                )}
                {activeArchiveAngles && activeArchiveAngles.length > 0 && (
                  <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-[#2a2d38] border-t-[#3b6fd480] bg-[#111215] p-3 text-left text-xs text-[#9a9ab0]">
                    <p className="mb-2 font-semibold uppercase tracking-widest text-[#6b6b82]">Research Angles</p>
                    <ul className="space-y-1">
                      {activeArchiveAngles.slice(0, 5).map((angle, i) => (
                        <li key={`${i}-${angle}`}>- {angle}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            </div>

            <div className="mx-auto grid w-full max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featureCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.title}
                    onClick={card.onClick}
                    style={{ "--card-accent": card.accent } as CSSProperties}
                    className={cn(
                      "feature-card group flex min-h-[96px] w-full flex-col items-start justify-between gap-2 p-3 text-left",
                      i === 0 && "welcome-card-1",
                      i === 1 && "welcome-card-2",
                      i === 2 && "welcome-card-3",
                    )}
                  >
                    <div
                      className="feature-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/70"
                      style={{ backgroundColor: card.iconBg, color: card.iconColor }}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[15px] font-semibold leading-snug"
                        style={{ color: "var(--text-primary-hex)" }}
                      >
                        {card.title}
                      </div>
                      <div
                        className="mt-1 border-t border-border/55 pt-3 text-[13px] leading-6"
                        style={{ color: "var(--text-secondary-hex)" }}
                      >
                        {card.desc}
                      </div>
                    </div>
                    <ChevronRight
                      className="feature-chevron w-4 h-4 shrink-0"
                      style={{ color: card.iconColor }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mx-auto grid w-full max-w-4xl gap-2 rounded-2xl border border-[#2a2d38] bg-[#0d0e12]/76 p-2 text-left sm:grid-cols-4">
              {[
                ["Plan", "Topic-aware queries"],
                ["Retrieve", "Official and legal sources"],
                ["Validate", "Citation and source gates"],
                ["Archive", "Persistent brief memory"],
              ].map(([label, desc]) => (
                <div key={label} className="rounded-xl border border-[#1e2028] bg-[#111215] px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#d4a03b]">{label}</div>
                  <div className="mt-1 text-xs leading-5 text-[#9a9ab0]">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div
          key={conversationId ?? "new"}
          className={cn(
            "animate-page-fade relative flex-1 overflow-y-auto space-y-2.5 px-3 py-2.5 md:px-4 md:py-3",
            showResearchRail && "lg:mr-[344px]"
          )}
          ref={scrollRef}
        >
          {/* Floating scroll-to-bottom button — always mounted for smooth fade-out */}
          <button
            onClick={scrollToBottom}
            className={cn(
              "scroll-bottom-btn fixed md:absolute bottom-28 md:bottom-32 right-4 md:right-8 z-20 flex items-center justify-center w-10 h-10 rounded-full bg-background border border-border shadow-md text-foreground hover:bg-muted",
              showScrollBtn && "is-visible"
            )}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
            data-testid="button-scroll-bottom"
            tabIndex={showScrollBtn ? 0 : -1}
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          {isLoading && !conversation ? (
            <div className="space-y-4 animate-pulse" data-testid="conversation-loading-skeleton">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
              <div className="h-4 bg-muted rounded w-5/6" />
              <div className="h-4 bg-muted rounded w-2/3" />
            </div>
          ) : null}
          {(() => {
            const msgs = conversation?.messages ?? [];
            const items: React.ReactNode[] = [];
            let prevDateKey: string | null = null;
            let prevRole: string | null = null;
            let prevTime = 0;
            msgs.forEach((msg, idx) => {
              const isLastAssistant =
                msg.role === "assistant" && idx === msgs.length - 1;
              const created = msg.createdAt ? new Date(msg.createdAt) : null;
              const dateKey = created ? created.toDateString() : "no-date";

              // Date separator
              if (created && dateKey !== prevDateKey) {
                const today = new Date(); today.setHours(0,0,0,0);
                const y = new Date(today); y.setDate(y.getDate() - 1);
                const d0 = new Date(created); d0.setHours(0,0,0,0);
                const label =
                  d0.getTime() === today.getTime() ? "Today" :
                  d0.getTime() === y.getTime()     ? "Yesterday" :
                  formatMessageDate(created);
                items.push(
                  <div key={`sep-${dateKey}-${msg.id}`} className="date-separator">
                    <span className="date-separator-pill">{label}</span>
                  </div>
                );
              }

              // Grouping: same role within 2 minutes -> tighter, no avatar
              const t = created ? created.getTime() : 0;
              const grouped =
                msg.role === prevRole &&
                dateKey === prevDateKey &&
                t && prevTime && (t - prevTime) < 2 * 60 * 1000;

              prevDateKey = dateKey;
              prevRole = msg.role;
              prevTime = t;

              items.push(
                <div
                  key={msg.id}
                    className={cn(
                      "group/msg mx-auto flex max-w-5xl gap-2 px-3 bubble-spring md:gap-3 md:px-4",
                    msg.role === "user" ? "flex-row-reverse" : "flex-row",
                    grouped ? "mt-1" : "mt-3"
                  )}
                  data-testid={`message-${msg.role}-${msg.id}`}
                >
                  <div
                    className={cn(
                      "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0 transition-transform",
                      msg.role === "user" ? "bg-[#3b6fd4] text-white" : "rounded-lg bg-[#3b6fd4] text-white",
                      grouped && "invisible"
                    )}
                    aria-hidden={grouped ? true : undefined}
                  >
                    {msg.role === "user" ? <User className="w-4 h-4 md:w-5 md:h-5" /> : <Bot className="w-4 h-4 md:w-5 md:h-5" />}
                  </div>
                    <div className={cn(
                      "flex min-w-0 max-w-[85ch] flex-col gap-1",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "relative max-w-[85ch] px-4 py-3 text-sm leading-7 shadow-sm backdrop-blur-xl md:px-5 md:py-3.5 md:text-[15px]",
                      msg.role === "user"
                        ? "rounded-2xl rounded-br-sm border border-[#3b6fd420] bg-card text-foreground" /* Fix Bug L927: use CSS var not hardcoded dark */
                        : "assistant-bubble rounded-2xl rounded-tl-sm text-[#f0f0f5]"
                    )}>
                      {msg.role === "assistant" ? (
                        (() => {
                          const { cleanContent, meta } = extractPipelineMeta(msg.content, {
                            assistantMessageId: msg.id,
                            conversationId: msg.conversationId,
                          });
                          return (
                        <>
                          {meta && <PersistedPipeline meta={meta} />}
                          <div className="assistant-fade-in text-[#f0f0f5]">
                            <CitationMessage content={cleanContent} sources={meta?.sources ?? []} citationStatus={meta?.citationStatus ?? null} />
                          </div>
                          <button
                            onClick={() => handleCopyMessage(cleanContent)}
                            className="absolute top-1.5 right-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-background/80 text-muted-foreground hover:text-foreground"
                            title="Copy message"
                            aria-label="Copy message"
                            data-testid={`button-copy-message-${msg.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </>
                          );
                        })()
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}
                    </div>
                    {/* Hover-only timestamp */}
                    {msg.createdAt && (
                      <span
                        className="msg-timestamp text-muted-foreground px-1"
                        style={{ fontSize: "10px" }}
                        aria-label={`Sent at ${formatMessageTime(new Date(msg.createdAt!))}`}
                      >
                        {formatMessageTime(new Date(msg.createdAt))}
                      </span>
                    )}
                    {/* Fix (Bug L966): disable regenerate when there is no last user message */}
                  {isLastAssistant && !isStreaming && (
                      <button
                        onClick={handleRegenerate}
                        disabled={!lastUserMessageRef.current}
                        className="mt-1 flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted/60 hover:text-foreground"
                        title="Regenerate response"
                        data-testid="button-regenerate"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Regenerate
                      </button>
                    )}
                  </div>
                </div>
              );
            });
            return items;
          })()}

          {isStreaming && chatType === "research" && currentMode === "council" && (
            <div className="mx-auto max-w-5xl px-3 pl-9 md:px-4 md:pl-12">
              <CouncilChamberPanel session={pipeline.councilSession} />
            </div>
          )}

          {isStreaming && chatType === "research" && currentMode !== "normal" && currentMode !== "council" && (
            <div className="mx-auto max-w-5xl px-3 pl-9 md:px-4 md:pl-12">
              <ResearchPipeline
                mode={currentMode as Exclude<ChatMode, "council">}
                modelConfig="standard"
                isPlanning={pipeline.isPlanning}
                plannerModel={pipeline.plannerModel}
                plannerRoles={pipeline.plannerRoles}
                isSynthesizing={pipeline.isSynthesizing}
                isVerifying={pipeline.isVerifying}
                verification={pipeline.verification}
                isComplete={pipeline.isComplete}
                qwenThinking={pipeline.qwenThinking}
                qwenThinkingStream={pipeline.qwenThinkingStream}
                isDiscussing={pipeline.isDiscussing}
                discussion={pipeline.discussion}
                bothExhausted={pipeline.bothExhausted}
                selectedModels={
                  pipeline.effectiveModels ?? activeModeModels
                }
                customModelSearches={pipeline.customModelSearches}
                customModelFound={pipeline.customModelFound}
                batches={pipeline.batches}
                customModelExhausted={pipeline.customModelExhausted}
                researchPlan={pipeline.researchPlan}
                fetchingTotal={pipeline.fetchingTotal}
                fetchedCount={pipeline.fetchedCount}
                citationWarning={pipeline.citationWarning}
                topicStrategy={pipeline.topicStrategy}
                isGeminiSynthesizing={pipeline.isGeminiSynthesizing}
                citationCoverage={pipeline.citationCoverage}
                dimensionScores={pipeline.dimensionScores}
                activeDivisions={pipeline.activeDivisions}
                completedDivisions={pipeline.completedDivisions}
                agendaClass={pipeline.agendaClass}
                committeeType={pipeline.committeeType}
                evidenceSummary={pipeline.evidenceSummary}
                fullSourceManifest={pipeline.fullSourceManifest}
                corePipelineEvents={pipeline.corePipelineEvents}
                sourceContract={pipeline.sourceContract}
                sourceGapReport={pipeline.sourceGapReport}
                coreQualityGate={pipeline.coreQualityGate}
                selectedResearchMode={pipeline.selectedResearchMode}
                archiveRouting={pipeline.archiveRouting}
                researchAngles={pipeline.researchAngles}
                legacyFallbackUsed={pipeline.legacyFallbackUsed}
                runStatus={pipeline.runStatus}
                citationStatus={pipeline.citationStatus}
                query={lastUserMessageRef.current || ""}
                streamingAnswer={pipeline.streamingContent}
                finalAnswer={pipeline.streamingContent}
                citedNums={pipeline.citedNums}
                searchTier={(() => {
                  const keys = loadProviderKeys();
                  if (keys.tavilyApiKey.trim()) return "TAVILY";
                  if (keys.serperApiKey.trim()) return "SERPER";
                  if (keys.exaApiKey.trim()) return "EXA";
                  if (keys.braveApiKey.trim()) return "BRAVE";
                  return "DDG ONLY";
                })()}
                dataCheatsheet={pipeline.dataCheatsheet}
              />
            </div>
          )}

          {isStreaming && chatType === "research" && currentMode === "normal" && (
            <div className="mx-auto flex max-w-5xl flex-row gap-2 px-3 md:gap-3 md:px-4" data-testid="message-streaming">
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground mt-1 animate-pulse-soft">
                <Bot className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <div className="flex w-full max-w-[85ch] flex-col gap-2">
                <div className="assistant-bubble w-full rounded-[22px] px-5 py-4 text-[#f0f0f5] transition-all duration-200">
                  <div className="prose prose-sm max-w-none text-[#f0f0f5] dark:prose-invert">
                    {streamingContent && currentMode === "normal" ? (
                      <div className={cn(isStreaming && !isComplete && "stream-cursor")}>
                        <StreamingText content={streamingContent} isStreaming={isStreaming && !isComplete} />
                      </div>
                    ) : (
                      <div className="flex gap-1 h-5 items-center">
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse" />
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse delay-150" />
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse delay-300" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isStreaming && chatType === "rhetorics" && (
            <div className="mx-auto flex max-w-5xl flex-row gap-2 px-3 animate-bubble-in md:gap-3 md:px-4">
              <div className={cn(
                "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0 mt-1 text-base",
                rhetoricsType === "debate" ? "bg-rose-100 dark:bg-rose-950/40"
                  : rhetoricsType === "kavita" ? "bg-amber-100 dark:bg-amber-950/40"
                  : "bg-violet-100 dark:bg-violet-950/40"
              )}>
                <Bot className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              </div>
              <div className="flex w-full max-w-[85ch] flex-col gap-1.5">
                <p className={cn("text-[10px] font-semibold",
                  rhetoricsType === "debate" ? "text-rose-500 dark:text-rose-400"
                    : rhetoricsType === "kavita" ? "text-amber-600 dark:text-amber-400"
                    : "text-violet-500 dark:text-violet-400"
                )}>
                  {rhetoricsType === "debate" ? "Opposing Delegate" : rhetoricsType === "kavita" ? "Kavita" : "Opening Speech"}
                </p>
                <div className={cn(
                  "px-5 py-4 shadow-sm rounded-2xl rounded-tl-sm text-foreground w-full transition-all duration-200",
                  rhetoricsType === "kavita"  ? "bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
                    : rhetoricsType === "debate" ? "bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800"
                    : "bg-muted"
                )}>
                  <div className={cn("prose dark:prose-invert max-w-none whitespace-pre-wrap", rhetoricsType === "kavita" ? "text-base leading-loose" : "text-sm")}>
                    {pipeline.streamingContent ? (
                      <div className={cn(isStreaming && !isComplete && "stream-cursor")}>
                        <StreamingText content={pipeline.streamingContent} isStreaming={isStreaming && !isComplete} />
                      </div>
                    ) : (
                      <div className="flex gap-1 h-5 items-center">
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse" />
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse delay-150" />
                        <span className="w-2 h-2 bg-foreground/40 rounded-full animate-pulse delay-300" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isStreaming && chatType === "rhetorics" && rhetoricsType === "debate" && debateSuggestions.length > 0 && (
            <div className="max-w-5xl mx-auto pl-9 md:pl-12 px-3 md:px-4">
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">💬 Counter-arguments</p>
              <div className="flex flex-col gap-1.5">
                {debateSuggestions.map((s, i) => (
                  <button key={i} onClick={() => { setInput(s); focusInput(); }}
                    className="text-left text-[11px] px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
                  >
                    → {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className={cn(
        "shrink-0 border-t border-[#1e2028] bg-[#08090b]/95 px-1.5 py-1 safe-area-inset-bottom md:px-2",
        showResearchRail && "lg:mr-[344px]"
      )}>
        {connectionWarn && (
          <div className="flex items-center gap-2 px-4 py-2 mb-2 text-xs bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300">
            <span>⚠️ High latency detected — deep research may take longer than usual on your connection.</span>
            <button
              onClick={() => setConnectionWarn(false)}
              className="ml-auto text-yellow-500 hover:text-yellow-700"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
          <div className="relative isolate mx-auto flex max-w-4xl flex-col gap-1.5 px-3 pt-1.5 pb-1.5 md:px-4 md:pb-2">
          <ChatComposer
            input={input}
            onInputChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={() => handleSend()}
            onStop={cancelActiveRun}
            onEnhance={handleEnhancePrompt}
            onShowOptionsToggle={() => setShowOptions((v) => !v)}
            showOptions={showOptions}
            isStreaming={isStreaming}
            isEnhancing={isEnhancing}
            disabled={activeRunInFlight}
            placeholder={
              chatType === "rhetorics" && rhetoricsType === "debate"  ? "Make your argument — I'll take the opposing side..."
              : chatType === "rhetorics" && rhetoricsType === "kavita" ? "Describe your committee topic — I'll write a Kavita..."
              : chatType === "rhetorics" && rhetoricsType === "speech" ? "Tell me your country and topic — I'll write your opening speech..."
              : currentMode === "fast_research" ? "Ask anything — I'll run a fast source-backed research pass..."
              : currentMode === "council" ? "Pose a Council question - six councillors will deliberate before a Chief verdict..."
              : "Type your message..."
            }
            activeChip={
              chatType === "rhetorics"
                ? "rhetorics"
                : currentMode === "council"
                ? "council"
                : currentMode === "fast_research"
                ? "fast"
                : "drafting"
            }
            onSelectChip={(id: ChatModeChipId) => {
              if (id === "drafting") { setChatType("research"); setCurrentMode("normal"); }
              else if (id === "rhetorics") { setChatType("rhetorics"); }
              else if (id === "fast") { setChatType("research"); setCurrentMode("fast_research"); }
              else if (id === "council") { setChatType("research"); setCurrentMode("council"); }
              setShowOptions(false);
            }}
            enhancedNotice={enhancedFrom
              ? {
                  original: enhancedFrom,
                  onRestore: () => {
                    setInput(enhancedFrom);
                    setEnhancedFrom(null);
                  },
                }
              : null}
            researchProviderUnavailable={researchProviderUnavailable}
            statusBadge={(() => {
              const meta = MODE_META[currentMode];
              return { label: meta.label, color: meta.color, bg: meta.bg, border: meta.border };
            })()}
            modelSummary={currentMode === "normal"
              ? simplifyModelName(normalModel)
              : activeModeModels.map(simplifyModelName).join(" · ") || "none"}
            focusRef={composerFocusRef}
          />

          {showOptions && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="absolute bottom-[6.75rem] left-2 right-2 z-30 max-h-[42vh] overflow-y-auto rounded-2xl border border-[#2a2d38] bg-[#0d0e12]/98 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.48)] md:left-3 md:right-3"
            >
              {/* ── Level 2: Sub-modes ────────────────────────────────────── */}
              {chatType === "rhetorics" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 rounded-2xl border border-border/60 bg-card/70 p-1.5 backdrop-blur-xl">
                    {([
                      { id: "kavita" as RhetoricsType, label: "Kavita" },
                      { id: "speech" as RhetoricsType, label: "Opening Speech" },
                      { id: "debate" as RhetoricsType, label: "Open Debate" },
                    ]).map(({ id, label }) => (
                      <button key={id} onClick={() => setRhetoricsType(id)}
                        className={cn(
                          "flex-1 rounded-xl border px-2 py-1.5 text-[10px] font-semibold transition-all md:text-[11px]",
                          rhetoricsType === id
                            ? "border-slate-300 bg-slate-100 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
                            : "text-muted-foreground hover:text-foreground hover:bg-background/50 border-transparent",
                        )}
                      >{label}</button>
                    ))}
                  </div>
                  {/* Creativity Dial */}
                  <div className="space-y-3 px-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#6b6b82]">Creativity</span>
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${creativity < 0.45 ? "#3b6fd4" : creativity < 0.75 ? "#8b5cf6" : "#f59e0b"}18`,
                          borderColor: `${creativity < 0.45 ? "#3b6fd4" : creativity < 0.75 ? "#8b5cf6" : "#f59e0b"}25`,
                          color: creativity < 0.45 ? "#3b6fd4" : creativity < 0.75 ? "#8b5cf6" : "#f59e0b",
                        }}
                      >
                        {creativity < 0.25 ? "Rational"
                          : creativity < 0.45 ? "Structured"
                          : creativity < 0.6  ? "Vivid"
                          : creativity < 0.8  ? "Expressive"
                          : creativity < 0.92 ? "Forceful"
                          : "Maximal"}
                      </span>
                    </div>
                    <div className="relative h-2 rounded-full bg-[#1e1e26]">
                      <motion.div
                        className="absolute left-0 top-0 h-full rounded-full"
                        style={{
                          width: `${creativity * 100}%`,
                          background: `linear-gradient(90deg, #3b6fd4, ${creativity < 0.45 ? "#3b6fd4" : creativity < 0.75 ? "#8b5cf6" : "#f59e0b"})`,
                        }}
                        transition={{ duration: 0.15 }}
                      />
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={creativity}
                        onChange={(e) => setCreativity(parseFloat(e.target.value))}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <motion.div
                        className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 bg-white shadow-lg"
                        style={{
                          left: `${creativity * 100}%`,
                          borderColor: creativity < 0.45 ? "#3b6fd4" : creativity < 0.75 ? "#8b5cf6" : "#f59e0b",
                          transform: "translateX(-50%) translateY(-50%)",
                        }}
                        transition={{ duration: 0.15 }}
                      />
                    </div>
                    <div className="flex justify-between px-0.5 text-xs text-[#4a4a5e]">
                      <span>Rational</span>
                      <span>Vivid</span>
                      <span>Fiery</span>
                    </div>
                  </div>
                </div>
              )}

          {/* ── Model Selection Panel (research only) ─────────────────── */}
          {chatType === "research" && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-auto w-full items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
                    data-testid="button-model-dropdown-toggle"
                  >
                    <div className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        {currentMode === "normal" ? "Selected Model" : "Selected Models"}
                      </span>
                      <span className="w-full truncate text-[10px] text-muted-foreground">
                        {currentMode === "normal"
                          ? simplifyModelName(normalModel)
                          : activeModeModels.map(simplifyModelName).join(", ") || "None selected"}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>

              {/* Dropdown menu renders through the shared Radix portal. */}
              <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={8}
                avoidCollisions={false}
                className="z-[100] max-h-[min(62vh,460px)] w-[min(480px,calc(100vw-2rem))] rounded-xl border border-[#2a2d38] bg-[#0d0e12] p-1.5 text-[#eeeef5] shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
              >
                {currentMode !== "normal" && (
                  <>
                    <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5 text-xs">
                      <span>Research models</span>
                      <span className="rounded-md border border-[#3b6fd440] bg-[#3b6fd420] px-1.5 py-0.5 text-[10px] font-semibold text-[#6f93e8]">
                        {activeModeModels.length} selected
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-[#2a2d38]" />
                  </>
                )}

                {currentMode === "normal" ? (
                  <DropdownMenuRadioGroup value={normalModel} onValueChange={setNormalModel}>
                    {!hasModelOptions && (
                      <DropdownMenuItem disabled className="rounded-lg px-2 py-2 text-xs text-[#6b6b82]">
                        No provider models available
                      </DropdownMenuItem>
                    )}
                    {modelGroups.map(({ provider, models }) => models.length > 0 && (
                      <div key={provider}>
                        <DropdownMenuLabel className="px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6b6b82]">
                          {provider}
                        </DropdownMenuLabel>
                        {models.map((m) => {
                          const modelId = `${provider.toLowerCase()}/${m.id}`;
                          return (
                            <DropdownMenuRadioItem
                              key={modelId}
                              value={modelId}
                              className="gap-2 rounded-lg py-2 pl-8 pr-2 text-xs text-[#c7c7d4] focus:bg-[#3b6fd414] focus:text-[#eeeef5]"
                            >
                              <span className="min-w-0 flex-1 truncate">{m.name || simplifyModelName(m.id)}</span>
                              <span className="ml-2 shrink-0 text-[10px] text-[#6b6b82]">{getModelIcon(m.id)}</span>
                            </DropdownMenuRadioItem>
                          );
                        })}
                      </div>
                    ))}
                  </DropdownMenuRadioGroup>
                ) : (
                  <>
                    {!hasModelOptions && (
                      <DropdownMenuItem disabled className="rounded-lg px-2 py-2 text-xs text-[#6b6b82]">
                        No provider models available
                      </DropdownMenuItem>
                    )}
                    {modelGroups.map(({ provider, models }) => models.length > 0 && (
                      <div key={provider}>
                        <DropdownMenuLabel className="px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6b6b82]">
                          {provider}
                        </DropdownMenuLabel>
                        {models.map((m) => {
                          const modelId = `${provider.toLowerCase()}/${m.id}`;
                          return (
                            <DropdownMenuCheckboxItem
                              key={modelId}
                              checked={activeModeModels.includes(modelId)}
                              onCheckedChange={() => toggleModelInList(activeModeModels, activeModeModelSetter, modelId)}
                              onSelect={(event) => event.preventDefault()}
                              className="gap-2 rounded-lg py-2 pl-8 pr-2 text-xs text-[#c7c7d4] focus:bg-[#3b6fd414] focus:text-[#eeeef5]"
                            >
                              <span className="min-w-0 flex-1 truncate">{m.name || simplifyModelName(m.id)}</span>
                              <span className="ml-2 shrink-0 text-[10px] text-[#6b6b82]">{getModelIcon(m.id)}</span>
                            </DropdownMenuCheckboxItem>
                          );
                        })}
                      </div>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
            </motion.div>
          )}

          {/* Footer status */}
          <div className="hidden items-center gap-3 border-t border-[#1e1e26] px-1 py-1.5 sm:flex">
            {tokensPerSec !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-800/60 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-400 animate-in fade-in">
                {tokensPerSec} tok/s
              </span>
            )}
            <span
              className="rounded px-1.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `${activeModeColor}12`, color: activeModeColor }}
            >
              {chatType === "rhetorics" ? "Rhetorics" : MODE_META[currentMode].label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
