import "server-only";
import { SearchProvider, SearchResult } from "./search-provider.interface";
import { SearchCitation } from "../types";
import { MockSearchProvider } from "./mock-search.provider";
import { logger } from "@/server/platform/logger";

interface CacheEntry {
  result: SearchResult;
  expiresAt: number;
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";
  private readonly apiKey: string;
  private readonly mockFallback = new MockSearchProvider();
  private static cache = new Map<string, CacheEntry>();
  private static CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BRAVE_SEARCH_API_KEY || "";
  }

  async search(query: string): Promise<SearchResult> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { query, citations: [], source: "live" };
    }

    // 1. Check in-memory cache
    const cacheKey = cleanQuery.toLowerCase();
    const cached = BraveSearchProvider.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, source: "cache" };
    }

    // 2. If no API key configured, use mock provider
    if (!this.apiKey) {
      logger.info(
        { query: cleanQuery },
        "BraveSearchProvider using mock fallback (no API key)",
      );
      return await this.mockFallback.search(cleanQuery);
    }

    // 3. Perform live search via Brave Search API
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(cleanQuery)}&count=3&search_lang=ar`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Brave Search API error, falling back to mock results",
        );
        return await this.mockFallback.search(cleanQuery);
      }

      const data = await response.json();
      const webResults = data.web?.results || [];

      interface BraveWebResult {
        title?: string;
        url: string;
        description?: string;
        page_age?: string;
      }

      const citations: SearchCitation[] = (webResults as BraveWebResult[]).map(
        (item) => ({
          title: item.title || "مصدر خارجي",
          url: item.url,
          snippet: item.description,
          publishedDate: item.page_age,
        }),
      );

      const searchResult: SearchResult = {
        query: cleanQuery,
        citations,
        source: "live",
      };

      // Store in cache
      BraveSearchProvider.cache.set(cacheKey, {
        result: searchResult,
        expiresAt: Date.now() + BraveSearchProvider.CACHE_TTL_MS,
      });

      return searchResult;
    } catch (err: unknown) {
      logger.error({ err, query: cleanQuery }, "Brave Search request failed");
      return await this.mockFallback.search(cleanQuery);
    }
  }
}
