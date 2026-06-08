import { useCallback, useEffect, useMemo, useState } from "react";
import { repairSelectedModel, repairSelectedModelList } from "@/hooks/provider-models";
import type { ChatMode } from "./chat-model-routing";
import { DEFAULT_GROQ_MODEL, VALID_MODEL_PREFIXES } from "./provider-model-display";

const WEB_MODELS_KEY = "lastWebSearchModels";
const DEEP_MODELS_KEY = "lastDeepResearchModels";

export interface ModeModelSelectionState {
  normalModel: string;
  webSearchModels: string[];
  deepResearchModels: string[];
}

interface UseModeModelSelectionInput {
  normalModel: string;
  setNormalModel: (model: string) => void;
  healthyResearchModels: string[];
  defaultModel?: string;
}

export function resolveModeModelSelection(mode: ChatMode | "web_search", state: ModeModelSelectionState): string[] {
  if (mode === "normal") return [state.normalModel];
  if (mode === "fast_research" || mode === "web_search") return state.webSearchModels;
  return state.deepResearchModels;
}

export function resolvePrimaryModeModel(mode: ChatMode | "web_search", state: ModeModelSelectionState): string {
  return resolveModeModelSelection(mode, state)[0] ?? state.normalModel;
}

export function repairModeModelSelection(
  state: ModeModelSelectionState,
  healthyResearchModels: string[],
): ModeModelSelectionState {
  if (healthyResearchModels.length === 0) return state;
  return {
    normalModel: repairSelectedModel(state.normalModel, healthyResearchModels) ?? state.normalModel,
    webSearchModels: repairSelectedModelList(state.webSearchModels, healthyResearchModels),
    deepResearchModels: repairSelectedModelList(state.deepResearchModels, healthyResearchModels),
  };
}

export function useModeModelSelection({
  normalModel,
  healthyResearchModels,
  defaultModel = DEFAULT_GROQ_MODEL,
}: UseModeModelSelectionInput) {
  const [rawWebSearchModels, setRawWebSearchModels] = useState<string[]>(() => loadModelList(WEB_MODELS_KEY, defaultModel));
  const [rawDeepResearchModels, setRawDeepResearchModels] = useState<string[]>(() => loadModelList(DEEP_MODELS_KEY, defaultModel));

  const selectionState = useMemo<ModeModelSelectionState>(() => {
    return repairModeModelSelection({
      normalModel,
      webSearchModels: rawWebSearchModels,
      deepResearchModels: rawDeepResearchModels,
    }, healthyResearchModels);
  }, [healthyResearchModels, normalModel, rawDeepResearchModels, rawWebSearchModels]);

  const { webSearchModels, deepResearchModels } = selectionState;

  const setWebSearchModels = useCallback((models: string[]) => {
    setRawWebSearchModels(repairSelectedModelList(models, healthyResearchModels));
  }, [healthyResearchModels]);

  const setDeepResearchModels = useCallback((models: string[]) => {
    setRawDeepResearchModels(repairSelectedModelList(models, healthyResearchModels));
  }, [healthyResearchModels]);

  useEffect(() => {
    try { localStorage.setItem(WEB_MODELS_KEY, JSON.stringify(webSearchModels)); } catch {}
  }, [webSearchModels]);

  useEffect(() => {
    try { localStorage.setItem(DEEP_MODELS_KEY, JSON.stringify(deepResearchModels)); } catch {}
  }, [deepResearchModels]);

  const getModelsForMode = useCallback((mode: ChatMode | "web_search", fallbackNormalModel = normalModel): string[] => {
    const stateForMode = repairModeModelSelection({
      ...selectionState,
      normalModel: fallbackNormalModel,
    }, healthyResearchModels);
    return resolveModeModelSelection(mode, stateForMode);
  }, [healthyResearchModels, normalModel, selectionState]);

  const getPrimaryModelForMode = useCallback((mode: ChatMode | "web_search", fallbackNormalModel = normalModel): string => {
    const stateForMode = repairModeModelSelection({
      ...selectionState,
      normalModel: fallbackNormalModel,
    }, healthyResearchModels);
    return resolvePrimaryModeModel(mode, stateForMode);
  }, [healthyResearchModels, normalModel, selectionState]);

  return {
    selectionState,
    webSearchModels,
    setWebSearchModels,
    deepResearchModels,
    setDeepResearchModels,
    getModelsForMode,
    getPrimaryModelForMode,
  };
}

function loadModelList(key: string, defaultModel: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(saved) && saved.length > 0 && saved.every((model) => typeof model === "string") && VALID_MODEL_PREFIXES.some((prefix) => saved[0]?.startsWith(prefix))) {
      return saved;
    }
  } catch {}
  return [defaultModel];
}
