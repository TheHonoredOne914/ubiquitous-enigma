import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("chat area delegates provider model hydration to the mode/model selection hook", async () => {
  const chatArea = await readFile(new URL("./chat-area.tsx", import.meta.url), "utf8");
  const modeSelection = await readFile(new URL("./use-mode-model-selection.ts", import.meta.url), "utf8");

  assert.match(chatArea, /useProviderModels\(\)/);
  assert.match(chatArea, /useModeModelSelection/);
  assert.match(modeSelection, /lastWebSearchModels/);
  assert.match(modeSelection, /lastDeepResearchModels/);
  assert.match(modeSelection, /repairModeModelSelection/);
  assert.match(modeSelection, /repairSelectedModel\(state\.normalModel/);
  assert.match(modeSelection, /useMemo/);
  assert.match(modeSelection, /selectionState = useMemo/);
  assert.doesNotMatch(modeSelection, /setWebSearchModels\(repaired\.webSearchModels\)/);
  assert.doesNotMatch(modeSelection, /setDeepResearchModels\(repaired\.deepResearchModels\)/);
});

test("model selection dropdown still renders provider groups and opens upward", async () => {
  const chatArea = await readFile(new URL("./chat-area.tsx", import.meta.url), "utf8");

  assert.match(chatArea, /modelGroups\.map/);
  assert.match(chatArea, /DropdownMenuRadioGroup/);
  assert.match(chatArea, /DropdownMenuCheckboxItem/);
  assert.match(chatArea, /side="top"/);
  assert.match(chatArea, /avoidCollisions=\{false\}/);
});
