import { generateText, streamText, tool, stepCountIs } from "ai";
import type { ToolDefinition, AgentRole, ModelRef } from "../types/index.js";
import { resolveModel, MODELS } from "./providers/index.js";
import { runClaudeCodeAgent, type ClaudeCodeAgentOptions } from "./claude-code/agent.js";

// ---------------------------------------------------------------------------
// LLM agent (Vercel AI SDK — any provider)
// ---------------------------------------------------------------------------

export interface LLMAgentOptions {
  role: AgentRole;
  model?: ModelRef;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: ToolDefinition<any, any>[];
  maxSteps?: number;
  /** Stream output chunks in real time instead of waiting for full response */
  stream?: boolean;
  onChunk?: (text: string) => void;
}

export interface AgentResult {
  output: string;
  cost: number;
  durationMs: number;
  kind: "llm" | "claude-code";
}

/**
 * Run a general-purpose LLM agent against any configured provider.
 * Use for: reasoning, planning, analysis, scoring, summarization.
 */
export async function runLLMAgent(
  task: string,
  options: LLMAgentOptions
): Promise<AgentResult> {
  const { role, model = MODELS.balanced, tools: toolDefs = [], maxSteps = 10, stream = false, onChunk } = options;

  // Build tool set — each entry must use `tool()` helper with inputSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiTools = toolDefs.length > 0
    ? Object.fromEntries(
        toolDefs.map((t) => [
          t.name,
          tool({
            description: t.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            inputSchema: t.inputSchema as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            execute: t.execute as any,
          }),
        ])
      )
    : undefined;

  const start = Date.now();
  const resolvedModel = resolveModel(model);
  const sharedParams = {
    model: resolvedModel,
    system: role.instructions,
    prompt: task,
    tools: aiTools,
    stopWhen: stepCountIs(maxSteps),
  } as const;

  let output = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (stream && onChunk) {
    const result = await streamText({ ...sharedParams, onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") onChunk(chunk.text);
    }});
    output = await result.text;
    const usage = await result.usage;
    inputTokens = usage?.inputTokens ?? 0;
    outputTokens = usage?.outputTokens ?? 0;
  } else {
    const result = await generateText(sharedParams);
    output = result.text;
    inputTokens = result.usage?.inputTokens ?? 0;
    outputTokens = result.usage?.outputTokens ?? 0;
  }

  return {
    output,
    cost: estimateCost(model, inputTokens, outputTokens),
    durationMs: Date.now() - start,
    kind: "llm",
  };
}

/**
 * Run a Claude Code agent.
 * Use for: file editing, bash execution, code implementation — tasks needing real tools.
 */
export async function runCodeAgent(
  task: string,
  options: ClaudeCodeAgentOptions
): Promise<AgentResult> {
  const result = await runClaudeCodeAgent(task, options);
  return { ...result, kind: "claude-code" };
}

// ---------------------------------------------------------------------------
// Cost estimation (USD per 1M tokens, approximate March 2026 pricing)
// ---------------------------------------------------------------------------

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6":           { input: 15,   output: 75   },
  "claude-sonnet-4-6":         { input: 3,    output: 15   },
  "claude-haiku-4-5-20251001": { input: 0.8,  output: 4    },
  "gpt-4o":                    { input: 2.5,  output: 10   },
  "gpt-4o-mini":               { input: 0.15, output: 0.6  },
  "gpt-4.1":                   { input: 2,    output: 8    },
  "gpt-4.1-mini":              { input: 0.4,  output: 1.6  },
  "gpt-4.1-nano":              { input: 0.1,  output: 0.4  },
  "o3":                        { input: 10,   output: 40   },
  "o3-mini":                   { input: 1.1,  output: 4.4  },
  "o4-mini":                   { input: 1.1,  output: 4.4  },
  "gemini-2.5-pro":            { input: 1.25, output: 10   },
  "llama3.2":                  { input: 0,    output: 0    },
};

function estimateCost(ref: ModelRef, inputTokens: number, outputTokens: number): number {
  const pricing = PRICE_PER_M[ref.model] ?? { input: 0, output: 0 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
