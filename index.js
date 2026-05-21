'use strict';

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const inquirer = require('inquirer');

const { banner, hr, phase, label, print, Spinner, col, C } = require('./src/cli');
const { LLMClient }    = require('./src/llm');
const { ElasticClient }= require('./src/elastic');
const { Session }      = require('./src/session');
const { runDemo, DEMO_ISSUE } = require('./src/demo');
const { execute }      = require('./src/executor');
const { toolDefs, dispatch, ALL_TOOLS } = require('./src/tools/registry');
const { parseThinkingLevel } = require('./src/args');
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

async function interactive(llm, es, defaultThinkingLevel) {

  // ── Phase 1: Issue Intake ────────────────────────────────────────────────
  phase(1, 'Issue Intake');

  let thinkingLevel = defaultThinkingLevel;
  let trimmed;

  // Loop to handle /thinking_level slash command before issue is collected.
  while (true) {
    const { issue } = await inquirer.prompt([{
      type:     'input',
      name:     'issue',
      message:  col(C.brightCyan, '>'),
      prefix:   '',
      validate: v => {
        const t = v.trim();
        if (t.startsWith('/')) return true;  // slash commands bypass length check
        return t.length > 4 || 'Please describe the issue in more detail.';
      },
    }]);

    const t = issue.trim();

    const thinkingMatch = t.match(/^\/thinking[_-]level\s+(\d+)$/i);
    if (thinkingMatch) {
      const n = parseInt(thinkingMatch[1], 10);
      if (n > 0) {
        thinkingLevel = n;
        print.info(`Thinking level set to ${n} (max ${n} iterations)`);
        console.log();
      } else {
        print.warn('/thinking_level requires a positive integer');
      }
      continue;
    }

    if (t.length > 4) {
      trimmed = t;
      break;
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

  if (!confirm) {
    print.info('Investigation cancelled.');
    console.log();
    return;
  }

  // Ensure output directory exists.
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  fs.mkdirSync(outputDir, { recursive: true });

  const session = new Session({ issue: trimmed, model: process.env.LLM_MODEL, maxIterations: thinkingLevel });

  // ── Phase 2: Investigation ───────────────────────────────────────────────
  phase(2, `Investigation  ·  up to ${session.maxIterations} iterations`);
  console.log(`  ${col(C.dim, 'Model:')} ${col(C.bold, process.env.LLM_MODEL)}  ${col(C.dim, '·  streaming live')}\n`);

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
        const parts = token.split('\n');
        for (let i = 0; i < parts.length; i++) {
          process.stdout.write(parts[i]);
          if (i < parts.length - 1) process.stdout.write('\n  ');
        }
      },

      onToolStart(_name) {
        if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
      },

      onStep(node, step) {
        if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
        print.step(step, node.tool, node.rationale);
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

      onConclude(report) {
        if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
        print.conclude();
        console.log();
        // Print the report inline since it arrived via tool args, not streamed.
        process.stdout.write('  ');
        const lines = report.split('\n');
        for (let i = 0; i < lines.length; i++) {
          process.stdout.write(lines[i]);
          if (i < lines.length - 1) process.stdout.write('\n  ');
        }
        process.stdout.write('\n');
        streamingContent = false;
      },

      onIteration(n) {
        if (n > 1 && streamingContent) { process.stdout.write('\n'); streamingContent = false; }
      },

      onMaxIter() {
        console.log();
        print.warn(`Reached max iterations (${session.maxIterations}). Requesting summary…`);
      },

      onDone() {
        if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
      },
    }
  );

  console.log();

  // ── Phase 3: Evidence & Exports ──────────────────────────────────────────
  phase(3, 'Evidence & Exports');

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

async function demoMode(defaultThinkingLevel) {
  // Phase 1 ─────────────────────────────────────────────────────────────────
  phase(1, 'Issue Intake  ' + col(C.yellow + C.bold, '[DEMO]'));

  let thinkingLevel = defaultThinkingLevel;
  let trimmed;

  while (true) {
    const { issue } = await inquirer.prompt([{
      type:    'input',
      name:    'issue',
      message: col(C.brightCyan, '>'),
      prefix:  '',
      default: DEMO_ISSUE,
      validate: v => {
        const t = v.trim();
        if (t.startsWith('/')) return true;
        return t.length > 4 || 'Please describe the issue in more detail.';
      },
    }]);

    const t = issue.trim() || DEMO_ISSUE;

    const thinkingMatch = t.match(/^\/thinking[_-]level\s+(\d+)$/i);
    if (thinkingMatch) {
      const n = parseInt(thinkingMatch[1], 10);
      if (n > 0) {
        thinkingLevel = n;
        print.info(`Thinking level set to ${n} (max ${n} iterations)`);
        console.log();
      } else {
        print.warn('/thinking_level requires a positive integer');
      }
      continue;
    }

    trimmed = t;
    break;
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

  const outputDir = path.resolve(process.env.OUTPUT_DIR || './output');
  fs.mkdirSync(outputDir, { recursive: true });

  const session = new Session({ issue: trimmed, model: 'demo-heuristic', maxIterations: thinkingLevel });

  // Phase 2 ─────────────────────────────────────────────────────────────────
  phase(2, `Investigation  ·  up to ${session.maxIterations} iterations  ` + col(C.yellow + C.bold, '[DEMO]'));
  console.log(`  ${col(C.dim, 'Model:')} ${col(C.bold, 'demo-heuristic')}  ${col(C.dim, '·  simulated streaming')}\n`);

  let streamingContent = false;

  const analysis = await runDemo(session, {
    onToken(token) {
      if (!streamingContent) { process.stdout.write('  '); streamingContent = true; }
      const parts = token.split('\n');
      for (let i = 0; i < parts.length; i++) {
        process.stdout.write(parts[i]);
        if (i < parts.length - 1) process.stdout.write('\n  ');
      }
    },

    onToolStart(_name) {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
    },

    onStep(node, step) {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
      print.step(step, node.tool, node.rationale);
    },

    onToolCall(name, params) {
      print.tool(name, params);
    },

    onToolResult(name, result) {
      print.toolResult(name, result);
    },

    onConclude(report) {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
      print.conclude();
      console.log();
      process.stdout.write('  ');
      const lines = report.split('\n');
      for (let i = 0; i < lines.length; i++) {
        process.stdout.write(lines[i]);
        if (i < lines.length - 1) process.stdout.write('\n  ');
      }
      process.stdout.write('\n');
      streamingContent = false;
    },

    onDone() {
      if (streamingContent) { process.stdout.write('\n'); streamingContent = false; }
    },
  });

  console.log();

  // Phase 3 ─────────────────────────────────────────────────────────────────
  phase(3, 'Evidence & Exports  ' + col(C.yellow + C.bold, '[DEMO]'));

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
  const thinkingLevel = parseThinkingLevel(args);

  // Demo mode needs no credentials — bail before env validation.
  if (args.includes('--demo'))     return demoMode(thinkingLevel);

  validateEnv();

  const { llm, es } = buildClients();
  if (args.includes('--test'))     return testConnectivity(es, llm);
  if (args.includes('--rollcall')) return rollCall(es);
  if (args.includes('--tools'))    return listTools();

  await interactive(llm, es, thinkingLevel);
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
