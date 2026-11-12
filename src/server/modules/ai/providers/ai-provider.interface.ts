import "server-only";
import { ChatMessage, ToolDefinition, ProviderResponse } from "../types";

export interface AIProvider {
  readonly name: string;

  /**
   * Generates a completion from the model given the conversation history and available tools.
   */
  generateChatCompletion(
    messages: ChatMessage[],
    systemInstruction: string,
    tools?: ToolDefinition[],
  ): Promise<ProviderResponse>;
}
