'use strict';

const SYSTEM_PROMPT = `You are Elastibot — an autonomous Elasticsearch administration assistant.

You investigate issues ONE STEP AT A TIME. On each turn:
1. Review the evidence gathered so far.
2. Decide the SINGLE most valuable next tool call — call exactly ONE tool.
3. After receiving the result, either call another tool or call \`conclude\`.

Call \`conclude\` when you have sufficient evidence to state a clear root cause and actionable
recommendations. Pass your complete final report as the \`report\` argument.

Investigation approach:
- Start with cluster_health and cat_allocation to get the big picture.
- Follow the evidence: yellow cluster → investigate shards → find cause → affected indices.
- Disk issues → check per-node allocation, then shard distribution.
- Slow queries → query_statistics, then inspect_index, then index_settings.
- ILM problems → ilm_explain with only_errors=true.

Final report format (use these exact markdown headers in \`conclude\`'s report argument):
## Summary
One-paragraph overview of what you found.

## Evidence
- Key metric 1 with actual value
- Key metric 2 with actual value

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
    role:    'user',
    content: `Issue reported: ${session.issue}\n\nBegin your investigation now.`,
  });

  for (let iter = 0; iter < session.maxIterations; iter++) {
    callbacks.onIteration?.(iter + 1, session.maxIterations);

    const result = await llmClient.stream(session.messages, toolDefs, {
      onToken:     callbacks.onToken,
      onToolStart: callbacks.onToolStart,
    });

    // Persist the assistant turn.
    const assistantMsg = { role: 'assistant' };
    if (result.content)           assistantMsg.content    = result.content;
    if (result.tool_calls.length) assistantMsg.tool_calls = result.tool_calls;
    session.addMessage(assistantMsg);

    // No tool calls → LLM finished naturally without calling conclude.
    if (!result.tool_calls.length) {
      callbacks.onDone?.(result.content);
      return result.content;
    }

    // Take only the first tool call — one DAG node per turn.
    const tc     = result.tool_calls[0];
    const name   = tc.function.name;
    let params;
    try   { params = JSON.parse(tc.function.arguments || '{}'); }
    catch { params = {}; }

    // Early exit via the conclude meta-tool.
    if (name === 'conclude') {
      const report = params.report || result.content || '';
      callbacks.onConclude?.(report);
      callbacks.onDone?.(report);
      return report;
    }

    // Display the new DAG node being added.
    callbacks.onStep?.({ step: iter + 1, tool: name, rationale: result.content || '' }, iter + 1);
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
    session.addDagNode({ step: iter + 1, tool: name, rationale: result.content || '', result: output });

    session.addMessage({
      role:         'tool',
      tool_call_id: tc.id,
      content:      JSON.stringify(output),
    });
  }

  // Reached iteration cap — ask the LLM to conclude with what it has.
  callbacks.onMaxIter?.();
  session.addMessage({
    role:    'user',
    content: 'You have reached the maximum number of investigation steps. Call `conclude` with your best analysis based on the evidence gathered so far.',
  });

  const final = await llmClient.stream(session.messages, toolDefs, {
    onToken: callbacks.onToken,
  });

  const assistantFinal = { role: 'assistant' };
  if (final.content)           assistantFinal.content    = final.content;
  if (final.tool_calls.length) assistantFinal.tool_calls = final.tool_calls;
  session.addMessage(assistantFinal);

  if (final.tool_calls.length && final.tool_calls[0].function.name === 'conclude') {
    let finalParams;
    try   { finalParams = JSON.parse(final.tool_calls[0].function.arguments || '{}'); }
    catch { finalParams = {}; }
    const report = finalParams.report || final.content || '';
    callbacks.onConclude?.(report);
    callbacks.onDone?.(report);
    return report;
  }

  callbacks.onDone?.(final.content);
  return final.content;
}

module.exports = { execute };
