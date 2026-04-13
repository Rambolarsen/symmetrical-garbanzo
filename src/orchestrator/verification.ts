import { z } from "zod";
import { resolveModelForTask } from "../agents/providers/index.js";
import { trackedGenerateObject } from "../agents/providers/tracked-generate-object.js";
import type { VerificationResult, RoutingContext, ProviderCallRecord, ProviderConfig } from "../types/index.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const VerificationSchema = z.object({
  overallPassed: z.boolean(),
  criteriaChecks: z.array(
    z.object({
      criterion: z.string(),
      passed: z.boolean(),
      evidence: z.string().describe(
        "What you found in the output supporting or contradicting this criterion. Be specific."
      ),
      confidence: z.number().min(0).max(1).describe(
        "How confident you are in this assessment (0 = uncertain, 1 = certain)."
      ),
    })
  ),
  summary: z.string().describe(
    "1-3 sentence overall verdict: what passed, what failed, and whether the task is done."
  ),
  recommendations: z.array(z.string()).optional().describe(
    "Actionable steps to fix failing criteria. Omit if everything passed."
  ),
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const VERIFIER_SYSTEM = `You are a verification agent. Your job is to assess whether the output of an AI development agent satisfies the stated success criteria.

Be objective and evidence-based. Do not pass criteria that lack clear evidence in the output. Do not fail criteria for cosmetic reasons.

For each criterion:
- Look for explicit evidence in the execution output (file mentions, test results, confirmations)
- If the output is ambiguous or silent on a criterion, mark it failed with low confidence
- Set confidence based on how clearly the output addresses the criterion

Overall pass/fail:
- overallPassed = true only if ALL criteria passed
- If even one criterion failed, overallPassed = false`;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

async function noopRecord(_record: ProviderCallRecord): Promise<void> {}

export interface VerifyInput {
  taskTitle: string;
  successCriteria: string[];
  executionOutput: string;
  routingContext?: Partial<RoutingContext>;  // override if needed; defaults to fast
  providerConfigs?: ProviderConfig[];
  onRecord?: (record: ProviderCallRecord) => Promise<void>;
}

export async function verifyExecution(input: VerifyInput): Promise<VerificationResult> {
  const { taskTitle, successCriteria, executionOutput } = input;

  if (successCriteria.length === 0) {
    return {
      overallPassed: true,
      criteriaChecks: [],
      summary: "No success criteria were defined — verification skipped.",
    };
  }

  const ctx: RoutingContext = {
    complexityScore: 0,     // always fast — verification is simple evidence assessment
    requiresToolUse: false,
    consumer: "general",
    ...input.routingContext,
  };

  const entry = resolveModelForTask(ctx);

  const userPrompt = `Task: ${taskTitle}

Success Criteria:
${successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Execution Output:
---
${executionOutput.trim() || "(no output captured)"}
---

Assess whether each criterion was satisfied based on the execution output above.`;

  const { object } = await trackedGenerateObject(
    entry,
    ctx,
    {
      schema: VerificationSchema,
      system: VERIFIER_SYSTEM,
      prompt: userPrompt,
    },
    input.providerConfigs ?? [],
    input.onRecord ?? noopRecord
  );

  // Map back to VerificationResult — ensure criteria array aligns with input
  const criteriaChecks = successCriteria.map((criterion, i) => {
    const check = object.criteriaChecks[i];
    return {
      criterion,
      passed: check?.passed ?? false,
      evidence: check?.evidence ?? "Not assessed.",
      confidence: check?.confidence ?? 0,
    };
  });

  return {
    overallPassed: object.overallPassed,
    criteriaChecks,
    summary: object.summary,
    recommendations: object.recommendations,
  };
}
