import { experimental_createMCPClient } from "ai";

// ---------------------------------------------------------------------------
// Serena MCP — semantic code search for any agent/provider
// ---------------------------------------------------------------------------
// Serena is an MCP server that understands your codebase at the symbol level.
// It exposes tools for finding symbols, references, and related code — far
// more accurate than text search. Because it runs as a plain MCP stdio server
// the tools it returns are standard Vercel AI SDK CoreTools, so they work
// with ANY provider (Anthropic, OpenAI, Google, Ollama).
//
// Usage:
//   const serena = await createSerenaClient("/path/to/project");
//   const result = await runLLMAgent(task, {
//     role,
//     mcpTools: serena.tools,   // ← passed straight to generateText
//   });
//   await serena.close();
//
// Or use the managed helper to avoid manual cleanup:
//   const result = await withSerenaTools("/path/to/project", (tools) =>
//     runLLMAgent(task, { role, mcpTools: tools })
//   );
// ---------------------------------------------------------------------------

export interface SerenaClient {
  /** AI SDK-compatible tools — pass directly as `mcpTools` to runLLMAgent */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>;
  /** Shuts down the MCP subprocess. Always call when done. */
  close: () => Promise<void>;
}

/**
 * Start a Serena MCP server for `projectPath` and return its tools.
 *
 * The caller is responsible for calling `close()` when finished.
 * Prefer `withSerenaTools` to ensure cleanup even on errors.
 *
 * @param projectPath - Absolute path to the project root Serena should index.
 */
export async function createSerenaClient(projectPath: string): Promise<SerenaClient> {
  const client = await experimental_createMCPClient({
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@oraios/serena", "--project-path", projectPath],
    },
  });

  const tools = await client.tools();

  return {
    tools,
    close: () => client.close(),
  };
}

/**
 * Managed helper: starts Serena, calls `fn` with its tools, then closes.
 * Cleanup happens even if `fn` throws.
 *
 * @example
 * const result = await withSerenaTools(process.cwd(), (tools) =>
 *   runLLMAgent("Find all database calls", { role, mcpTools: tools })
 * );
 */
export async function withSerenaTools<T>(
  projectPath: string,
  fn: (tools: SerenaClient["tools"]) => Promise<T>
): Promise<T> {
  const serena = await createSerenaClient(projectPath);
  try {
    return await fn(serena.tools);
  } finally {
    await serena.close();
  }
}
