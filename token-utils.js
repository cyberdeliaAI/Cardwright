// Lightweight token estimation for Cardwright.
// Offline there is no model tokenizer, so we use the common ~4 chars/token
// heuristic. This matches the extension's fallback estimate, so token numbers
// are comparable between the two tools (approximate, not exact).

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.round(String(text).length / 4);
}
