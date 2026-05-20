'use strict';

const MAX_ITER = parseInt(process.env.MAX_ITERATIONS || '20', 10);

const SYSTEM_PROMPT = `You are Elastibot — an autonomous Elasticsearch administration assistant.

You have direct access to Elasticsearch API tools. Your mission:
1. Investigate the reported issue methodically using the available tools.
2. Call tools iteratively — each result should inform the next call. Drill down from broad to specific.
3. Do NOT stop after the first tool call. Build a body of evidence before concluding.
4. Correlate findings across multiple calls (e.g. disk pressure on a node → unassigned shards → affected indices).
5. When you have enough evidence to state a clear root cause and actionable recommendations, write your FINAL REPORT.

Investigation approach:
- Start with cluster_health and cat_allocation to get the big picture.
- Follow the evidence: a yellow cluster → investigate unassigned shards → find the reason → identify affected indices.
- Disk issues → check allocation per node, then specific shard distribution.
- Slow queries → query_statistics, then inspect_index on suspect indices, then index_settings.
- ILM problems → ilm_explain with only_errors=true.

Final report format (use these exact markdown headers):
## Summary
One-paragraph overview of what you found.

## Evidence
- Key metric 1 with actual value
- Key metric 2 with actual value
(cite real numbers from tool results)

## Root Cause
Clear, direct statement of the identified root cause(s).

## Recommendations
1. Immediate action
2. Short-term fix
3. Long-term prevention

## Risk Assessment
**LOW** / **MEDIUM** / **HIGH** — one sentence on impact of leaving this unresolved.`;

async function execute(session, llmClient, esClient, tools, callbacks = {}) {
  const { toolDefs, dispatch } = tools;

  session.addMessage({ role: 'system', content: SYSTEM_PROMPT });
  session.addMessage({
    role: 'user',
    content: `Issue reported: ${session.issue}\n\nBegin your investigation now.`,
  });

  for (let iter = 0; iter < MAX_ITER; iter++) {
    callbacks.onIteration?.(iter + 1);

    const result = await llmClient.stream(session.messages, toolDefs, {
      onToken:     callbacks.onToken,
      onToolStart: callbacks.onToolStart,
    });

    // Persist the assistant turn (may have content, tool_calls, or both).
    const assistantMsg = { role: 'assistant' };
    if (result.content)             assistantMsg.content    = result.content;
    if (result.tool_calls.length)   assistantMsg.tool_calls = result.tool_calls;
    session.addMessage(assistantMsg);

    // No tool calls means the LLM has finished its analysis.
    if (!result.tool_calls.length) {
      callbacks.onDone?.(result.content);
      return result.content;
    }

    // Execute each tool call and feed results back as tool messages.
    for (const tc of result.tool_calls) {
      const name = tc.function.name;
      let params;
      try   { params = JSON.parse(tc.function.arguments || '{}'); }
      catch { params = {}; }

      callbacks.onToolCall?.(name, params);

      let output;
      try {
        output = await dispatch(name, params, esClient);
        callbacks.onToolResult?.(name, output);
      } catch (err) {
        output = { error: err.message };
        callbacks.onToolError?.(name, err);
      }

      session.addEvidence({ tool: name, params, result: output });
      session.addMessage({
        role:        'tool',
        tool_call_id: tc.id,
        content:     JSON.stringify(output),
      });
    }
  }

  // Reached iteration cap — ask for a summary of what we have so far.
  callbacks.onMaxIter?.();
  session.addMessage({
    role:    'user',
    content: 'You have reached the maximum number of tool calls. Please provide your best analysis based on the evidence gathered so far.',
  });

  const final = await llmClient.stream(session.messages, [], {
    onToken: callbacks.onToken,
  });
  return final.content;
}

module.exports = { execute };
