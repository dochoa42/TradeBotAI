import type { StrategyDefinition } from "../types/trading";

const BASE_URL = "/api/strategies";

export async function fetchStrategyDefinitions(symbol?: string): Promise<StrategyDefinition[]> {
  const params = new URLSearchParams();
  if (symbol && symbol.trim()) {
    params.set("symbol", symbol.trim());
  }
  const qs = params.toString();
  const res = await fetch(`${BASE_URL}${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error("Failed to load strategy library");
  }
  return res.json();
}

export type SaveStrategyDefinitionBody = {
  symbol: string;
  strategy_name: string;
  indicators_json: string;
  notes?: string;
};

export async function saveStrategyDefinition(
  body: SaveStrategyDefinitionBody
): Promise<StrategyDefinition> {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to save strategy definition");
  }

  return res.json();
}
