'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const http     = require('node:http');

const { Session }              = require('../src/session');
const { toolDefs, dispatch, ALL_TOOLS } = require('../src/tools/registry');
const { LLMClient }            = require('../src/llm');
const { parsePlan }            = require('../src/planner');
const { parseThinkingLevel }   = require('../src/args');
const { execute }              = require('../src/executor');

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

// ── Session (new fields) ──────────────────────────────────────────────────────

test('Session: dag starts empty and maxIterations defaults to 20', () => {
  const s = new Session({ issue: 'test', model: 'x' });
  assert.ok(Array.isArray(s.dag), 'dag should be an array');
  assert.equal(s.dag.length, 0);
  assert.equal(s.maxIterations, 20);
});

test('Session: addDagNode appends a node with an ISO timestamp', () => {
  const s = new Session({ issue: 'test', model: 'x' });
  s.addDagNode({ step: 1, tool: 'cluster_health', rationale: 'baseline', result: { status: 'yellow' } });

  assert.equal(s.dag.length, 1);
  const node = s.dag[0];
  assert.equal(node.tool, 'cluster_health');
  assert.equal(node.step, 1);
  assert.ok(!isNaN(Date.parse(node.timestamp)), 'timestamp is not a valid date');
});

test('Session: maxIterations can be overridden via constructor', () => {
  const s = new Session({ issue: 'test', model: 'x', maxIterations: 5 });
  assert.equal(s.maxIterations, 5);
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

test('registry: ALL_TOOLS count matches toolDefs count and includes conclude', () => {
  assert.equal(ALL_TOOLS.length, toolDefs.length);
  assert.ok(ALL_TOOLS.length >= 13, `expected at least 13 tools (12 ES + conclude), got ${ALL_TOOLS.length}`);
});

test('registry: conclude tool exists in toolDefs with required report parameter', () => {
  const def = toolDefs.find(d => d.function.name === 'conclude');
  assert.ok(def, 'conclude toolDef should exist');
  const params = def.function.parameters;
  assert.ok(Array.isArray(params.required) && params.required.includes('report'), 'report should be required');
  assert.ok(params.properties && params.properties.report, 'report property should be defined');
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

// ── parsePlan ─────────────────────────────────────────────────────────────────

test('parsePlan: returns only summary/hypothesis/priority and strips extra fields', () => {
  const raw = JSON.stringify({
    summary:   'Test summary',
    hypothesis:'Test hypothesis',
    priority:  'high',
    investigation_steps: [{ step: 1, tool: 'cluster_health' }],
  });
  const result = parsePlan(raw);
  assert.equal(result.summary,    'Test summary');
  assert.equal(result.hypothesis, 'Test hypothesis');
  assert.equal(result.priority,   'high');
  assert.ok(!('investigation_steps' in result), 'investigation_steps should be stripped');
});

test('parsePlan: returns null for unparseable input', () => {
  assert.equal(parsePlan('not json'), null);
  assert.equal(parsePlan(''),         null);
});

test('parsePlan: strips markdown fences before parsing', () => {
  const raw = '```json\n{"summary":"s","hypothesis":"h","priority":"low"}\n```';
  const result = parsePlan(raw);
  assert.ok(result !== null, 'should parse despite markdown fences');
  assert.equal(result.summary, 's');
});

// ── parseThinkingLevel ───────────────────────────────────────────────────────

test('parseThinkingLevel: extracts integer from --thinking-level flag', () => {
  assert.equal(parseThinkingLevel(['--thinking-level', '5', 'my problem']), 5);
  assert.equal(parseThinkingLevel(['--demo', '--thinking-level', '10']),    10);
});

test('parseThinkingLevel: returns null when flag is absent or invalid', () => {
  assert.equal(parseThinkingLevel(['my problem']),              null);
  assert.equal(parseThinkingLevel(['--thinking-level', 'abc']), null);
  assert.equal(parseThinkingLevel(['--thinking-level', '0']),   null);
  assert.equal(parseThinkingLevel([]),                           null);
});

// ── Executor: early exit via conclude ────────────────────────────────────────

test('executor: stops immediately on conclude tool call (dag remains empty)', (t, done) => {
  // LLM server immediately returns a conclude tool call on the first request.
  const frames = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_c1', function: { name: 'conclude', arguments: '' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"report":"early exit report"}' } }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];

  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
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
    const session = new Session({ issue: 'test issue', model: 'test', maxIterations: 5 });
    const mockTools = { toolDefs: [], dispatch: async () => ({}) };

    let concludeReport = null;
    try {
      const report = await execute(session, client, null, mockTools, {
        onConclude: (r) => { concludeReport = r; },
      });

      assert.equal(report, 'early exit report',          'returned report should match conclude argument');
      assert.equal(concludeReport, 'early exit report',  'onConclude should receive the report');
      assert.equal(session.dag.length, 0,                'no ES tools were called — dag should be empty');
      assert.equal(requestCount, 1,                      'should make exactly 1 LLM request');
    } catch (err) {
      done(err);
      return;
    } finally {
      server.close();
    }
    done();
  });
});
