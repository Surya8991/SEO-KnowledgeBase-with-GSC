/**
 * Single source of truth for the LLM kill switch (audit M, Session 11).
 *
 * Set LLM_KILL_SWITCH=1 in the environment and redeploy to disable all
 * server-side LLM calls instantly without a code push. Previously this env
 * check was duplicated in BaseChatProvider.safeComplete AND
 * lib/drafts/runtime.ts — a drift-prone second copy of the same contract.
 * Both now call this helper.
 */
export function llmKillSwitchActive(): boolean {
  return process.env.LLM_KILL_SWITCH === "1";
}

export function assertLlmEnabled(context = "AI calls"): void {
  if (llmKillSwitchActive()) {
    throw new Error(`LLM_KILL_SWITCH is active — ${context} are disabled.`);
  }
}
