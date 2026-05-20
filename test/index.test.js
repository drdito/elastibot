'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const http     = require('node:http');

const { Session }              = require('../src/session');
const { toolDefs, dispatch, ALL_TOOLS } = require('../src/tools/registry');
const { LLMClient }            = require('../src/llm');

// ── Session ──────────────────────────────────────────────────────────────────

test('Session: addMessage preserves insertion order', () => {
  const s = new Session({ issue: 'test', model: 'x' });
  s.addMessage({ role: 'system',    content: 'sys' });
  s.addMessage({ role: 'user',      content: 'u1'  });
  s.addMessage({ role: 'assistant', content: 'a1'  });

  assert.equal(s.messages.length, 3);
  assert.equal(s.messages[0].role, 'system');
  assert.equal(s.messages[1].role, 'user');
  assert.equal(s.messages[2].role, 'assistant');
});

test('Session: addEvidence attaches an ISO timestamp', () => {
  const s = new Session({ issue: 'test', model: 'x' });
  s.addEvidence({ tool: 'cluster_health', params: {}, result: { status: 'green' } });

  assert.equal(s.evidence.length, 1);
  const entry = s.evidence[0];
  assert.equal(entry.tool, 'cluster_health');
  // timestamp must be a valid ISO date string
  assert.ok(!isNaN(Date.parse(entry.timestamp)), 'timestamp is not a valid date');
});

// ── Tool registry ─────────────────────────────────────────────────────────────

test('registry: toolDefs have the expected { name, description, parameters } shape', () => {
  assert.ok(Array.isArray(toolDefs), 'toolDefs is not an array');
  assert.ok(toolDefs.length > 0,    'toolDefs is empty');
  for (const def of toolDefs) {
    assert.equal(def.type, 'function', `def.type is not "function" for ${def.function?.name}`);
    const fn = def.function;
    assert.ok(typeof fn.name        === 'string' && fn.name,        `missing name in toolDef`);
    assert.ok(typeof fn.description === 'string' && fn.description, `missing description for ${fn.name}`);
    assert.ok(fn.parameters && typeof fn.parameters === 'object',   `missing parameters for ${fn.name}`);
  }
});

test('registry: dispatch throws a clear error for an unknown tool', async () => {
  await assert.rejects(
    () => dispatch('nonexistent_tool', {}, null),
    (err) => {
      assert.ok(err.message.includes('nonexistent_tool'), 'error message should name the bad tool');
      assert.ok(err.message.includes('Unknown tool'),     'error message should say "Unknown tool"');
      return true;
    }
  );
});

test('registry: ALL_TOOLS count matches toolDefs count', () => {
  assert.equal(ALL_TOOLS.length, toolDefs.length);
  assert.ok(ALL_TOOLS.length >= 12, `expected at least 12 tools, got ${ALL_TOOLS.length}`);
});

// ── LLM SSE stream parsing ────────────────────────────────────────────────────
//
// Spin up a local HTTP server that emits pre-crafted SSE frames so the full
// stream() code path runs against real bytes — no mocking of the LLM client.

test('LLMClient.stream: reconstructs tool-call arguments split across SSE deltas', (t, done) => {
  // Simulate a server that streams a tool call whose JSON arguments arrive in
  // three separate SSE chunks (common in practice).
  const frames = [
    // Chunk 1: tool call id + function name arrive
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'cluster_health', arguments: '' } }] }, finish_reason: null }] },
    // Chunk 2: first half of arguments
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"filter' } }] }, finish_reason: null }] },
    // Chunk 3: second half of arguments
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '":"all"}' } }] }, finish_reason: null }] },
    // Chunk 4: done token
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of frames) {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  server.listen(0, '127.0.0.1', async () => {
    const { port } = server.address();
    const client = new LLMClient({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey:  'test',
      model:   'test-model',
    });

    try {
      const toolStartNames = [];
      const result = await client.stream(
        [{ role: 'user', content: 'ping' }],
        [],
        { onToolStart: (name) => toolStartNames.push(name) }
      );

      assert.equal(result.tool_calls.length, 1, 'expected 1 tool call');
      const tc = result.tool_calls[0];
      assert.equal(tc.function.name,      'cluster_health');
      assert.equal(tc.function.arguments, '{"filter":"all"}', 'arguments not reassembled correctly');
      assert.equal(tc.id,                 'call_abc');

      // onToolStart must fire exactly once
      assert.equal(toolStartNames.length, 1);
      assert.equal(toolStartNames[0], 'cluster_health');
    } catch (err) {
      done(err);
      return;
    } finally {
      server.close();
    }
    done();
  });
});
