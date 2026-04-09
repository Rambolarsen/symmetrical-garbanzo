import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRole, ExecutionStreamEvent, ClarificationRequest } from "../../types/index.js";

export interface ClaudeCodeAgentOptions {
  role: AgentRole;
  workingDirectory?: string;
  /** Called for each text chunk streamed from the agent */
  onChunk?: (text: string) => void;
  /** Called for structured stream events (tool calls, etc.) */
  onEvent?: (event: ExecutionStreamEvent) => void;
  /**
   * Called before each tool use. Return true to allow, false to deny.
   * Receives the tool name so you can whitelist/blacklist specific tools.
   */
  canUseTool?: (toolName: string) => boolean;
  permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
  /**
   * When provided, a `request_clarification` tool is injected into the agent.
   * Called when the agent needs human input; resolves with the human's answer.
   */
  clarificationHandler?: (request: ClarificationRequest) => Promise<string>;
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
  const {
    role,
    workingDirectory,
    onChunk,
    onEvent,
    canUseTool,
    permissionMode = "default",
    clarificationHandler,
  } = options;

  // Inject clarification tool instructions into the system prompt when a handler is provided
  const clarificationInstructions = clarificationHandler
    ? `\n\nWhen you are uncertain how to proceed and need human input, call the \`request_clarification\` tool with your question and relevant context. Do NOT guess or assume — pause and ask.`
    : "";

  const prompt = `${role.instructions}${clarificationInstructions}\n\n---\n\nTask:\n${task}`;

  const start = Date.now();
  let output = "";
  let costUsd = 0;

  for await (const message of query({
    prompt,
    options: {
      cwd: workingDirectory,
      permissionMode,
      // Note: @anthropic-ai/claude-agent-sdk only supports built-in tool presets via `tools`,
      // not arbitrary custom tool objects. The request_clarification mechanism is wired up
      // via prompt instructions + onEvent/clarificationHandler, and will be fully activated
      // once the SDK exposes custom tool registration.
      canUseTool: canUseTool
        ? async (toolName: string) => {
            // Always allow clarification tool
            if (toolName === "request_clarification") return { behavior: "allow" as const };
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
          onEvent?.({
            type: "progress",
            message: block.text,
            timestamp: new Date().toISOString(),
          });
        }

        // Emit tool_call events; handle request_clarification specially
        if (block.type === "tool_use") {
          const toolInput = block.input as Record<string, unknown>;

          if (block.name === "request_clarification" && clarificationHandler) {
            const request: ClarificationRequest = {
              requestId: block.id,
              question: String(toolInput["question"] ?? ""),
              context: String(toolInput["context"] ?? ""),
              options: Array.isArray(toolInput["options"])
                ? (toolInput["options"] as string[])
                : undefined,
            };
            onEvent?.({ type: "clarification_needed", ...request });
            // Pause and wait — execution resumes once the handler resolves
            await clarificationHandler(request);
          } else {
            onEvent?.({
              type: "tool_call",
              toolName: block.name,
              inputPreview: JSON.stringify(block.input).slice(0, 120),
              timestamp: new Date().toISOString(),
            });
          }
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
