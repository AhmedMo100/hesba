/**
 * @file visuals.ts
 * @description A chart beside an assistant answer (ADR-0039). The chart is never written by the
 * model: it is built on the server from a read-only tool's result (today: the shop's latest
 * stocktake), so every bar is the shop's own number. It is kept with the answer — inside the
 * message's `sources` JSON, next to the web citations — so it shows again in the history.
 */
import type { SearchCitation } from "@/server/infra/ai/contracts";
import type { StocktakeChartData } from "@/domain/stocktake-charts";

export interface AiVisual {
  kind: "stocktake";
  title: string;
  data: StocktakeChartData;
}

/** The chart a tool's result carries, if any. */
export function visualFromTool(name: string, result: unknown): AiVisual | null {
  if (name !== "getStocktakeResult") return null;
  const r = result as {
    found?: boolean;
    scope?: string;
    chart?: StocktakeChartData;
  };
  if (!r?.found || !r.chart) return null;
  return {
    kind: "stocktake",
    title: `نتيجة آخر جرد — ${r.scope ?? ""}`.trim(),
    data: r.chart,
  };
}

/** What is stored in `ai_messages.sources`: the citations, then the chart (if any). */
export function packSources(
  citations: SearchCitation[],
  visual: AiVisual | null,
): unknown[] | null {
  const out: unknown[] = [...citations];
  if (visual) out.push({ visual });
  return out.length > 0 ? out : null;
}

/** Splits a stored `sources` back into citations and the chart. */
export function unpackSources(stored: unknown): {
  sources: SearchCitation[] | undefined;
  visual: AiVisual | null;
} {
  if (!Array.isArray(stored)) return { sources: undefined, visual: null };
  let visual: AiVisual | null = null;
  const sources: SearchCitation[] = [];
  for (const item of stored) {
    if (item && typeof item === "object" && "visual" in item) {
      const v = (item as { visual: AiVisual }).visual;
      if (v?.kind === "stocktake") visual = v;
    } else if (item && typeof item === "object" && "url" in item) {
      sources.push(item as SearchCitation);
    }
  }
  return { sources: sources.length ? sources : undefined, visual };
}
