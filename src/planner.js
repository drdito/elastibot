'use strict';

const SYSTEM = `You are Elastibot, an expert Elasticsearch administrator.
The user will describe a cluster issue. Provide a quick initial assessment as JSON.

Respond ONLY with a valid JSON object — no markdown fences, no commentary.

Schema:
{
  "summary":    "<one-sentence restatement of the issue>",
  "hypothesis": "<your initial hypothesis about the likely root cause>",
  "priority":   "high" | "medium" | "low"
}`;

// Extract and normalise only the three fields we care about, discarding anything else
// (e.g. investigation_steps that an older prompt variant might have returned).
function parsePlan(raw) {
  const cleaned = (raw || '').replace(/^```[a-z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary:    parsed.summary    || '',
      hypothesis: parsed.hypothesis || '',
      priority:   ['high', 'medium', 'low'].includes(parsed.priority) ? parsed.priority : 'medium',
    };
  } catch {
    return null;
  }
}

async function plan(issue, llmClient) {
  const response = await llmClient.complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: issue },
    ],
    [] // no tools for the planning call
  );

  const result = parsePlan(response.content);
  if (result) return result;

  // Graceful fallback — proceed with a generic hypothesis rather than crashing.
  return {
    summary:    issue.slice(0, 120),
    hypothesis: 'Unable to parse initial assessment. Proceeding with general investigation.',
    priority:   'medium',
  };
}

module.exports = { plan, parsePlan };
