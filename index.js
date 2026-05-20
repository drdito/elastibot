'use strict';

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const inquirer = require('inquirer');

const { banner, hr, phase, label, print, Spinner, col, C } = require('./src/cli');
const { LLMClient }    = require('./src/llm');
const { ElasticClient }= require('./src/elastic');
const { Session }      = require('./src/session');
const { runDemo, DEMO_PLAN, DEMO_ISSUE } = require('./src/demo');
const { plan }         = require('./src/planner');
const { execute }      = require('./src/executor');
const { toolDefs, dispatch, ALL_TOOLS } = require('./src/tools/registry');
const { generate: genHTML }  = require('./src/export/html');
const { exportEvidence }     = require('./src/export/csv');

// ── Environment validation ──────────────────────────────────────────────────

function validateEnv() {
  const required = ['ES_URL', 'ES_API_KEY', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    print.error(`Missing required env vars: ${missing.join(', ')}`);
    print.info('Copy .env.example → .env and fill in your credentials.');
    process.exit(1);
  }
}

// ── Client factory ──────────────────────────────────────────────────────────

function buildClients() {
  return {
    llm: new LLMClient({
      baseUrl: process.env.LLM_BASE_URL,
      apiKey:  process.env.LLM_API_KEY,
      model:   process.env.LLM_MODEL,
    }),
    es: new ElasticClient({
      url:    process.env.ES_URL,
      apiKey: process.env.ES_API_KEY,
    }),
  };
}

// ── --test: connectivity check ──────────────────────────────────────────────

async function testConnectivity(es, llm) {
  phase(0, 'Connectivity Check');

  const esSpinner = new Spinner('Pinging Elasticsearch…').start();
  try {
    const h = await es.get('/_cluster/health?timeout=5s');
    const statusColor = h.status === 'green' ? C.brightGreen : h.status === 'yellow' ? C.yellow : C.red;
    esSpinner.stop(
      `Elasticsearch  ${col(C.bold, h.cluster_name)}  ` +
      `status ${col(statusColor, h.status)}  ` +
      `nodes ${h.number_of_nodes}`
    );
  } catch (err) {
    esSpinner.fail(`Elasticsearch: ${err.message}`);
  }

  const llmSpinner = new Spinner(`Pinging LLM (${process.env.LLM_MODEL})…`).start();
  try {
    await llm.complete([{ role: 'user', content: 'ping' }]);
    llmSpinner.stop(`LLM  ${col(C.bold, process.env.LLM_MODEL)}  reachable`);
  } catch (err) {
    llmSpinner.fail(`LLM: ${err.message}`);
  }

  console.log();
}

// ── --rollcall: quick cluster overview ─────────────────────────────────────

async function rollCall(es) {
  phase(0, 'Roll Call — Cluster Snapshot');

  const spinner = new Spinner('Querying cluster…').start();
  let health, nodes, indices;
  try {
    [health, nodes, indices] = await Promise.all([
      es.get('/_cluster/health'),
      es.get('/_cat/nodes?format=json&v&s=name&h=name,role,heap.percent,cpu,load_1m,disk.used_percent'),
      es.get('/_cat/indices?format=json&bytes=gb&s=store.size:desc&v&h=health,index,pri,rep,docs.count,store.size'),
    ]);
    spinner.stop('Cluster data retrieved');
  } catch (err) {
    spinner.fail(err.message);
    return;
  }

  const statusColor = health.status === 'green' ? C.brightGreen : health.status === 'yellow' ? C.yellow : C.red;

  console.log();
  label('Cluster Health');
  console.log(`    Name      ${health.cluster_name}`);
  console.log(`    Status    ${col(statusColor, health.status.toUpperCase())}`);
  console.log(`    Nodes     ${health.number_of_nodes} total  (${health.number_of_data_nodes} data)`);
  console.log(`    Shards    ${health.active_shards} active  ${col(C.yellow, health.relocating_shards + ' relocating')}  ${col(C.red, health.unassigned_shards + ' unassigned')}`);
  console.log(`    Tasks     ${health.number_of_pending_tasks} pending`);

  console.log();
  label(`Nodes  (${nodes.length})`);
  for (const n of nodes) {
    const heap = parseInt(n['heap.percent'] || '0', 10);
    const heapColor = heap > 85 ? C.red : heap > 70 ? C.yellow : C.brightGreen;
    console.log(
      `    ${col(C.bold, (n.name || n.ip || '?').padEnd(28))}` +
      `  role ${(n.role || '?').padEnd(6)}` +
      `  heap ${col(heapColor, (n['heap.percent'] || '?') + '%').padEnd(14)}` +
      `  cpu ${(n.cpu || '?') + '%'}`
    );
  }

  console.log();
  label(`Largest Indices  (top ${Math.min(indices.length, 15)})`);
  for (const idx of indices.slice(0, 15)) {
    const hc = idx.health === 'green' ? C.brightGreen : idx.health === 'yellow' ? C.yellow : C.red;
    console.log(
      `    ${col(hc, '●')} ${col(C.bold, (idx.index || '?').padEnd(40))}` +
      `  ${((idx['store.size'] || '?') + ' GB').padEnd(10)}` +
      `  ${(idx['docs.count'] || '?')} docs`
    );
  }

  console.log();
}

// ── --tools: list available tools ──────────────────────────────────────────

function listTools() {
  phase(0, 'Available Tools');
  for (const t of ALL_TOOLS) {
    console.log(`  ${col(C.magenta, '⚙')}  ${col(C.bold, t.name.padEnd(22))} ${col(C.gray, t.description.slice(0, 72))}`);
  }
  console.log();
}

// ── Interactive investigation mode ─────────────────────────────────────────

async function interactive(llm, es) {

  // ── Phase 1: Issue Intake ────────────────────────────────────────────────
  phase(1, 'Issue Intake');

  const { issue } = await inquirer.prompt([{
    type:     'input',
    name:     'issue',
    message:  col(C.brightCyan, '>'),
    prefix:   '',
    validate: v => v.trim().length > 4 || 'Please describe the issue in more detail.',
  }]);

  const trimmed = issue.trim();
  console.log();

  // Ensure output directory exists.
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  fs.mkdirSync(outputDir, { recursive: true });

  const session = new Session({ issue: trimmed, model: process.env.LLM_MODEL });

  // ── Phase 2: DAG Planning ────────────────────────────────────────────────
  phase(2, 'DAG Planning');

  const planSpinner = new Spinner('Generating investigation plan…').start();
  let dagPlan;
  try {
    dagPlan = await plan(trimmed, llm);
    planSpinner.stop('Investigation plan ready');
  } catch (err) {
    planSpinner.fail(`Planning failed: ${err.message}`);
    process.exit(1);
  }

  // Render the plan.
  console.log();
  const priorityColor = { high: C.red, medium: C.yellow, low: C.green }[dagPlan.priority] || C.gray;
  console.log(`  ${col(C.bold, 'Issue     ')}  ${dagPlan.summary}`);
  console.log(`  ${col(C.bold, 'Hypothesis')}  ${dagPlan.hypothesis}`);
  console.log(`  ${col(C.bold, 'Priority  ')}  ${col(priorityColor + C.bold, (dagPlan.priority || 'medium').toUpperCase())}`);
  console.log();

  if (Array.isArray(dagPlan.investigation_steps) && dagPlan.investigation_steps.length) {
    console.log(`  ${col(C.bold + C.underline, 'Planned Investigation')}\n`);
    for (const step of dagPlan.investigation_steps) {
      const toolStr = step.tool ? `  ${col(C.magenta, '[' + step.tool + ']')}` : '';
      console.log(`  ${col(C.gray, String(step.step) + '.')}  ${step.description}${toolStr}`);
      if (step.conditions) {
        if (step.conditions.if_positive) console.log(`       ${col(C.gray, '├ if concerning:')} ${step.conditions.if_positive}`);
        if (step.conditions.if_negative) console.log(`       ${col(C.gray, '└ if normal:    ')} ${step.conditions.if_negative}`);
      }
    }
    console.log();
  }

  const { confirm } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirm',
    message: 'Proceed with autonomous investigation?',
    default: true,
    prefix:  '  ',
  }]);

  if (!confirm) {
    print.info('Investigation cancelled.');
    console.log();
    return;
  }

  // ── Phase 3: Tool Execution ──────────────────────────────────────────────
  phase(3, 'Tool Execution  (MCP-style)');
  console.log(`  ${col(C.dim, 'Model:')} ${col(C.bold, process.env.LLM_MODEL)}  ${col(C.dim, '·  streaming live')}\n`);

  // We track whether we're mid-content-stream so we can add newlines before tool banners.
  let streamingContent = false;

  const analysis = await execute(
    session,
    llm,
    es,
    { toolDefs, dispatch },
    {
      onToken(token) {
        if (!streamingContent) {
          process.stdout.write('  ');
          streamingContent = true;
        }
        // Re-indent lines within streamed content.
        const parts = token.split('\n');
        for (let i = 0; i < parts.length; i++) {
          process.stdout.write(parts[i]);
          if (i < parts.length - 1) {
            process.stdout.write('\n  ');
          }
        }
      },

      onToolStart(name) {
        if (streamingContent) {
          process.stdout.write('\n');
          streamingContent = false;
        }
        // Tool banners are printed in onToolCall (we have params there).
      },

      onToolCall(name, params) {
        print.tool(name, params);
      },

      onToolResult(name, result) {
        print.toolResult(name, result);
      },

      onToolError(name, err) {
        print.toolError(name, err);
      },

      onIteration(n) {
        if (n > 1 && streamingContent) {
          process.stdout.write('\n');
          streamingContent = false;
        }
      },

      onMaxIter() {
        console.log();
        print.warn(`Reached max iterations (${process.env.MAX_ITERATIONS || 20}). Requesting summary…`);
      },

      onDone() {
        if (streamingContent) {
          process.stdout.write('\n');
          streamingContent = false;
        }
      },
    }
  );

  console.log();

  // ── Phase 4: Evidence & Exports ──────────────────────────────────────────
  phase(4, 'Evidence & Exports');

  const htmlPath = genHTML(session, analysis, outputDir);
  session.addExport('html', htmlPath);
  print.success(`HTML report  →  ${col(C.cyan, htmlPath)}`);

  const csvPaths = exportEvidence(session.evidence, outputDir);
  for (const p of csvPaths) {
    session.addExport('csv', p);
    print.success(`CSV export   →  ${col(C.cyan, p)}`);
  }

  console.log();
  hr();
  console.log();
  print.success(
    `Done  ·  ${session.duration}s  ·  ${session.evidence.length} tool calls  ·  ` +
    `${session.exports.length} export${session.exports.length !== 1 ? 's' : ''}`
  );
  console.log();
}

// ── Demo mode ───────────────────────────────────────────────────────────────
// Full UI walkthrough using heuristic responses — no real ES or LLM needed.

async function demoMode() {
  // Phase 1 ─────────────────────────────────────────────────────────────────
  phase(1, 'Issue Intake  ' + col(C.yellow + C.bold, '[DEMO]'));

  const { issue } = await inquirer.prompt([{
    type:    'input',
    name:    'issue',
    message: col(C.brightCyan, '>'),
    prefix:  '',
    default: DEMO_ISSUE,
  }]);

  const trimmed = issue.trim() || DEMO_ISSUE;
  console.log();

  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  fs.mkdirSync(outputDir, { recursive: true });

  const session = new Session({ issue: trimmed, model: 'demo-heuristic' });

  // Phase 2 ─────────────────────────────────────────────────────────────────
  phase(2, 'DAG Planning  ' + col(C.yellow + C.bold, '[DEMO]'));

  const planSpinner = new Spinner('Generating investigation plan…').start();
  await new Promise(r => setTimeout(r, 1400));
  planSpinner.stop('Investigation plan ready');

  const dagPlan = DEMO_PLAN;
  console.log();
  console.log(`  ${col(C.bold, 'Issue     ')}  ${dagPlan.summary}`);
  console.log(`  ${col(C.bold, 'Hypothesis')}  ${dagPlan.hypothesis}`);
  console.log(`  ${col(C.bold, 'Priority  ')}  ${col(C.red + C.bold, dagPlan.priority.toUpperCase())}`);
  console.log();
  console.log(`  ${col(C.bold + C.underline, 'Planned Investigation')}\n`);

  for (const step of dagPlan.investigation_steps) {
    const toolStr = step.tool ? `  ${col(C.magenta, '[' + step.tool + ']')}` : '';
    console.log(`  ${col(C.gray, String(step.step) + '.')}  ${step.description}${toolStr}`);
    if (step.conditions) {
      if (step.conditions.if_positive) console.log(`       ${col(C.gray, '├ if concerning:')} ${step.conditions.if_positive}`);
      if (step.conditions.if_negative) console.log(`       ${col(C.gray, '└ if normal:    ')} ${step.conditions.if_negative}`);
    }
  }
  console.log();

  const { confirm } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirm',
    message: 'Proceed with autonomous investigation?',
    default: true,
    prefix:  '  ',
  }]);

  if (!confirm) { print.info('Demo cancelled.'); console.log(); return; }

  // Phase 3 ─────────────────────────────────────────────────────────────────
  phase(3, 'Tool Execution  (MCP-style)  ' + col(C.yellow + C.bold, '[DEMO]'));
  console.log(`  ${col(C.dim, 'Model:')} ${col(C.bold, 'demo-heuristic')}  ${col(C.dim, '·  simulated streaming')}\n`);

  let streamingContent = false;

  const analysis = await runDemo(session, {
    onToken(token) {
      if (!streamingContent) {
        process.stdout.write('  ');
        streamingContent = true;
      }
      const parts = token.split('\n');
      for (let i = 0; i < parts.length; i++) {
        process.stdout.write(parts[i]);
        if (i < parts.length - 1) process.stdout.write('\n  ');
      }
    },

    onToolStart(_name) {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
    },

    onToolCall(name, params) {
      print.tool(name, params);
    },

    onToolResult(name, result) {
      print.toolResult(name, result);
    },

    onDone() {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
    },
  });

  console.log();

  // Phase 4 ─────────────────────────────────────────────────────────────────
  phase(4, 'Evidence & Exports  ' + col(C.yellow + C.bold, '[DEMO]'));

  const htmlPath = genHTML(session, analysis, outputDir);
  session.addExport('html', htmlPath);
  print.success(`HTML report  →  ${col(C.cyan, htmlPath)}`);

  const csvPaths = exportEvidence(session.evidence, outputDir);
  for (const p of csvPaths) {
    session.addExport('csv', p);
    print.success(`CSV export   →  ${col(C.cyan, p)}`);
  }

  console.log();
  hr();
  console.log();
  print.success(
    `Demo complete  ·  ${session.duration}s  ·  ${session.evidence.length} tool calls  ·  ` +
    `${session.exports.length} export${session.exports.length !== 1 ? 's' : ''}`
  );
  print.info(`Open the HTML report to see the full evidence view.`);
  console.log();
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  banner();

  const args = process.argv.slice(2);

  // Demo mode needs no credentials — bail before env validation.
  if (args.includes('--demo'))     return demoMode();

  validateEnv();

  const { llm, es } = buildClients();
  if (args.includes('--test'))     return testConnectivity(es, llm);
  if (args.includes('--rollcall')) return rollCall(es);
  if (args.includes('--tools'))    return listTools();

  await interactive(llm, es);
}

// Inquirer v8 emits this on SIGINT / piped-stdin close — not a real crash.
process.on('uncaughtException', err => {
  if (err.code === 'ERR_USE_AFTER_CLOSE') process.exit(0);
  print.error(err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

main().catch(err => {
  print.error(err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
