import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRole } from "../../types/index.js";

export interface ClaudeCodeAgentOptions {
  role: AgentRole;
  workingDirectory?: string;
  /** Called for each text chunk streamed from the agent */
  onChunk?: (text: string) => void;
  /**
   * Called before each tool use. Return true to allow, false to deny.
   * Receives the tool name so you can whitelist/blacklist specific tools.
   */
  canUseTool?: (toolName: string) => boolean;
  permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
}

export interface ClaudeCodeAgentResult {
  output: string;
  cost: number;
  durationMs: number;
}

/**
 * Runs a Claude Code agent for one task.
 *
 * Use this for tasks that need real tool execution:
 *   - File read/write/edit
 *   - Bash commands
 *   - Code implementation, refactoring
 *
 * NOT for: reasoning, planning, analysis — use runLLMAgent for those.
 */
export async function runClaudeCodeAgent(
  task: string,
  options: ClaudeCodeAgentOptions
): Promise<ClaudeCodeAgentResult> {
  const { role, workingDirectory, onChunk, canUseTool, permissionMode = "default" } = options;

  const prompt = `${role.instructions}\n\n---\n\nTask:\n${task}`;

  const start = Date.now();
  let output = "";
  let costUsd = 0;

  for await (const message of query({
    prompt,
    options: {
      cwd: workingDirectory,
      permissionMode,
      canUseTool: canUseTool
        ? async (toolName: string) => {
            const allowed = canUseTool(toolName);
            if (allowed) return { behavior: "allow" as const };
            return { behavior: "deny" as const, message: `Tool '${toolName}' denied by orchestrator` };
          }
        : undefined,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          output += block.text;
          onChunk?.(block.text);
        }
      }
    }

    if (message.type === "result") {
      costUsd = message.total_cost_usd ?? 0;
    }
  }

  return {
    output,
    cost: costUsd,
    durationMs: Date.now() - start,
  };
}
