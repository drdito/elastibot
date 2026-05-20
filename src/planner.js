'use strict';

const SYSTEM = `You are Elastibot, an expert Elasticsearch administrator.
The user will describe a cluster issue. Create a structured investigation plan as JSON.

Respond ONLY with a valid JSON object — no markdown fences, no commentary.

Schema:
{
  "summary":   "<one-sentence restatement of the issue>",
  "hypothesis": "<your initial hypothesis about the likely root cause>",
  "priority":   "high" | "medium" | "low",
  "investigation_steps": [
    {
      "step":        1,
      "description": "<what to look at>",
      "tool":        "<tool_name from the available list>",
      "rationale":   "<why this tool reveals this symptom>",
      "conditions": {
        "if_positive": "<next action if finding is concerning>",
        "if_negative": "<next action if finding looks normal>"
      }
    }
  ]
}

Available tools: cluster_health, cat_indices, cat_shards, cat_allocation, inspect_index,
index_settings, query_statistics, ilm_summary, ilm_explain, node_stats, snapshot_status, pending_tasks.`;

async function plan(issue, llmClient) {
  const response = await llmClient.complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: issue },
    ],
    [] // no tools for the planning call
  );

  const raw = response.content || '';
  // Strip any accidental markdown fences models sometimes add despite instructions.
  const cleaned = raw.replace(/^```[a-z]*\s*/m, '').replace(/```\s*$/m, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Graceful fallback — proceed with a generic plan rather than crashing.
    return {
      summary:   issue.slice(0, 120),
      hypothesis:'Unable to parse structured plan. Proceeding with general investigation.',
      priority:  'medium',
      investigation_steps: [
        { step: 1, description: 'Check overall cluster health',    tool: 'cluster_health'  },
        { step: 2, description: 'Inspect node disk allocation',    tool: 'cat_allocation'  },
        { step: 3, description: 'Survey index sizes and statuses', tool: 'cat_indices'     },
        { step: 4, description: 'Check for unassigned shards',     tool: 'cat_shards',
          conditions: { if_positive: 'Investigate unassigned reasons', if_negative: 'Check ILM' } },
        { step: 5, description: 'Review ILM policy errors',        tool: 'ilm_explain',
          conditions: { if_positive: 'Fix ILM policy',               if_negative: 'Check node stats' } },
      ],
    };
  }
}

module.exports = { plan };
