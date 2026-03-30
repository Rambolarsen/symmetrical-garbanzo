import express from "express";
import http from "http";
import { createTerminus } from "@godaddy/terminus";
import { runClaudeCodeAgent } from "./agents/claude-code/agent.js";
import type { AgentRole } from "./types/index.js";

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

interface RunAgentRequest {
  task: string;
  role: AgentRole;
  workingDirectory?: string;
  allowedTools?: string[];       // whitelist — omit to allow all
  permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk";
}

interface RunAgentResponse {
  output: string;
  cost: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));

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
