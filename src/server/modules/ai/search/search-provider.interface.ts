import "server-only";
import { SearchCitation } from "../types";

export interface SearchResult {
  query: string;
  citations: SearchCitation[];
  summary?: string;
  source: "live" | "cache" | "mock";
}

export interface SearchProvider {
  readonly name: string;

  /**
   * Searches external web data for commodity prices, inflation, fuel, or wholesale news.
   * Private shop data MUST NEVER be passed into this method.
   */
  search(query: string): Promise<SearchResult>;
}
