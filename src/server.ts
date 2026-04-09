import express from "express";
import http from "http";
import { createTerminus } from "@godaddy/terminus";
import { runClaudeCodeAgent } from "./agents/claude-code/agent.js";
import { runLLMAgent } from "./agents/agent-factory.js";
import { MODELS } from "./agents/providers/index.js";
import type { AgentRole, ExecutionStreamEvent, ClarificationRequest } from "./types/index.js";

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

interface RunAgentRequest {
  task: string;
  role: AgentRole;
  workingDirectory?: string;
  allowedTools?: string[];       // whitelist — omit to allow all
  permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
  enableClarification?: boolean; // inject request_clarification tool
}

interface RunAgentResponse {
  output: string;
  cost: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Pending clarifications — keyed by requestId (tool use block id)
// ---------------------------------------------------------------------------

const pendingClarifications = new Map<string, (answer: string) => void>();

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function writeSseEvent(res: express.Response, event: ExecutionStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));

// Existing synchronous endpoint — kept for backward compatibility
app.post("/agents/run", async (req, res) => {
  const body = req.body as RunAgentRequest;

  if (!body.task || !body.role) {
    res.status(400).json({ error: "task and role are required" });
    return;
  }

  try {
    const result = await runClaudeCodeAgent(body.task, {
      role: body.role,
      workingDirectory: body.workingDirectory,
      permissionMode: body.permissionMode ?? "default",
      canUseTool: body.allowedTools
        ? (toolName) => body.allowedTools!.includes(toolName)
        : undefined,
    });

    const response: RunAgentResponse = result;
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// SSE streaming endpoint — streams ExecutionStreamEvents as the agent runs
app.post("/agents/stream", async (req, res) => {
  const body = req.body as RunAgentRequest;

  if (!body.task || !body.role) {
    res.status(400).json({ error: "task and role are required" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
  res.flushHeaders();

  const emit = (event: ExecutionStreamEvent) => writeSseEvent(res, event);

  // Build clarification handler when requested
  const clarificationHandler = body.enableClarification
    ? (request: ClarificationRequest): Promise<string> => {
        emit({ type: "clarification_needed", ...request });
        return new Promise<string>((resolve) => {
          pendingClarifications.set(request.requestId, resolve);
        });
      }
    : undefined;

  try {
    const result = await runClaudeCodeAgent(body.task, {
      role: body.role,
      workingDirectory: body.workingDirectory,
      permissionMode: body.permissionMode ?? "default",
      canUseTool: body.allowedTools
        ? (toolName) => body.allowedTools!.includes(toolName)
        : undefined,
      onEvent: (event) => {
        // Don't double-emit clarification_needed — it's sent by clarificationHandler
        if (event.type !== "clarification_needed") emit(event);
      },
      clarificationHandler,
    });

    emit({ type: "complete", output: result.output, cost: result.cost, durationMs: result.durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    emit({ type: "error", message });
  } finally {
    res.end();
  }
});

// Serena-powered task-specific code context retrieval — called by .NET planning service
app.post("/serena/context", async (req, res) => {
  const { projectPath, task } = req.body as { projectPath: string; task: string };

  if (!projectPath || !task) {
    res.status(400).json({ error: "projectPath and task required" });
    return;
  }

  try {
    const result = await runLLMAgent(
      `Task: ${task}\n\nFind files and code relevant to this task. Return file paths and content excerpts only. Be concise (max 2000 chars).`,
      {
        role: {
          name: "Context Extractor",
          instructions: `You are a code context extractor. Use Serena tools to find code relevant to the given task.
Steps:
1. Identify file paths and symbol names mentioned in the task
2. Use list_dir on mentioned directories
3. Use find_symbol or search_for_pattern to locate relevant functions/classes
4. Use get_symbols_overview on relevant files
Return a concise summary (max 2000 chars): file paths and key content excerpts only. No prose.`,
        },
        model: MODELS.fast,
        useSerena: true,
        projectPath,
        maxSteps: 8,
      }
    );
    res.json({ context: result.output });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Serena context failed";
    res.status(500).json({ error: message });
  }
});

// Resolve a pending clarification — called by the frontend after the human answers
app.post("/agents/clarify/:requestId", (req, res) => {
  const { requestId } = req.params;
  const { answer } = req.body as { answer: string };

  if (!answer) {
    res.status(400).json({ error: "answer is required" });
    return;
  }

  const resolve = pendingClarifications.get(requestId);
  if (!resolve) {
    res.status(404).json({ error: "No pending clarification with that requestId" });
    return;
  }

  pendingClarifications.delete(requestId);
  resolve(answer);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Server + Aspire health checks
// ---------------------------------------------------------------------------

const server = http.createServer(app);

createTerminus(server, {
  healthChecks: {
    "/health": async () => { /* dependency checks go here */ },
    "/alive": async () => { /* liveness — always resolves */ },
  },
  onShutdown: async () => {
    console.log("Sidecar shutting down...");
  },
});

const port = parseInt(process.env["PORT"] ?? "3000", 10);

server.listen(port, () => {
  console.log(`Claude Code sidecar listening on http://localhost:${port}`);
});
