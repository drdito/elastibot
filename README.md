# ⚡ Elastibot

**Autonomous Elasticsearch Administration Harness**

A command-line agent that investigates Elasticsearch cluster issues end-to-end — from natural-language problem description to structured diagnosis, evidence tables, and exported reports. The LLM plans a DAG of API calls, executes them iteratively against your cluster, and streams a root-cause analysis with actionable recommendations.

> This is a public portfolio analog of a tool I built and deployed in a professional context. The architecture, agentic loop, and tool-registry pattern reflect the real implementation; data, credentials, and client-specific context have been replaced.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                        ELASTIBOT PIPELINE                       │
│                                                                 │
│  Phase 1         Phase 2          Phase 3         Phase 4       │
│  ─────────       ────────         ──────────       ──────────   │
│  Issue Intake → DAG Planning → Tool Execution → Evidence &      │
│                                (agentic loop)    Exports        │
│                                                                 │
│  User describes  LLM produces    LLM calls ES    HTML report    │
│  the problem     a structured    tools, reads     + CSV per     │
│  in plain text   investigation   results, calls   tabular tool  │
│                  plan with       more tools,      result        │
│                  decision        streams final                  │
│                  branches        analysis                       │
└─────────────────────────────────────────────────────────────────┘
```

The agent loop runs until the LLM stops emitting tool calls, at which point the accumulated evidence becomes the basis for the final report.

---

## Features

- **Model-agnostic** — works with any `/chat/completions`-compatible endpoint (OpenAI, Azure OpenAI, Ollama, vLLM, Anthropic-compatible proxies)
- **Unified ES/Kibana auth** — one API key in `.env` covers both services
- **Streaming output** — analysis types out live as the LLM generates it, Claude Code style
- **DAG planner** — a dedicated planning call produces a structured investigation plan with conditional branches before any tools are invoked
- **MCP-style tool registry** — 12 parameterized Elasticsearch API tools registered in a clean `{ name, description, parameters, execute }` contract
- **Agentic loop** — the executor runs tool calls, feeds results back into the message thread, and continues until the LLM is satisfied
- **Evidence exports** — HTML report (dark-theme, collapsible per-tool tables) and CSV files for every array result
- **Nearly dependency-free** — only `dotenv` and `inquirer`; all HTTP (including SSE streaming) handled with Node's native `https` module

---

## Project structure

```
elastibot/
├── index.js                    # Entry point: CLI harness, modes, orchestration
├── src/
│   ├── cli.js                  # ANSI rendering, spinner, phase headers
│   ├── llm.js                  # LLMClient — complete() and stream() over native https
│   ├── elastic.js              # ElasticClient — ApiKey auth over native https
│   ├── session.js              # Session state: messages, evidence, exports
│   ├── planner.js              # Phase 2: issue → structured JSON DAG plan
│   ├── executor.js             # Phase 3: agentic tool-calling loop
│   ├── demo.js                 # Demo mode: heuristic responses, typewriter stream
│   ├── tools/
│   │   ├── registry.js         # Collects all tools; exports toolDefs + dispatch()
│   │   ├── cluster_health.js
│   │   ├── cat_indices.js
│   │   ├── cat_shards.js
│   │   ├── cat_allocation.js
│   │   ├── inspect_index.js
│   │   ├── index_settings.js
│   │   ├── query_statistics.js
│   │   ├── ilm_summary.js
│   │   ├── ilm_explain.js
│   │   ├── node_stats.js
│   │   ├── snapshot_status.js
│   │   └── pending_tasks.js
│   └── export/
│       ├── html.js             # Dark-theme HTML evidence report
│       └── csv.js              # CSV from any array-valued tool result
└── output/                     # Generated reports (gitignored)
```

---

## Prerequisites

- Node.js 18+
- An Elasticsearch cluster with an API key that has at least `monitor` cluster privilege
- Any OpenAI-compatible LLM endpoint

---

## Installation

```bash
git clone https://github.com/drdito/elastibot.git
cd elastibot
npm install
cp .env.example .env
# edit .env with your credentials
```

---

## Configuration

```env
# Elasticsearch / Kibana — shared API key
ES_URL=https://your-cluster.es.io:9200
ES_API_KEY=your_base64_encoded_api_key

# Kibana (optional, same key)
KIBANA_URL=https://your-cluster.kb.io:5601

# LLM — any OpenAI-compatible /chat/completions endpoint
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Output directory for generated reports
OUTPUT_DIR=./output

# Safety cap on agentic iterations (default 20)
MAX_ITERATIONS=20
```

Set `ES_TLS_VERIFY=false` for clusters with self-signed certificates.

Set `DEBUG=true` to print full stack traces on errors (useful during setup).

---

## Usage

### Interactive investigation

```bash
npm start
```

Describe your issue at the prompt. The agent plans, investigates, and streams a full diagnosis.

**Example issues:**

- *"Disk usage is high on node1 and node2 and we have unassigned shards"*
- *"Indexing throughput dropped 60% in the last hour on the metrics-* indices"*
- *"Several ILM policies appear stuck — indices are not rolling over"*
- *"Cluster went yellow overnight, heap usage is elevated on all nodes"*

### Demo mode (no credentials needed)

```bash
node index.js --demo
```

Runs through all four phases with heuristic responses and a simulated typewriter stream. Produces a real HTML report and CSVs in `./output`. Good for evaluating the UI before connecting a real cluster.

### Additional modes

```bash
node index.js --test       # Verify ES and LLM connectivity
node index.js --rollcall   # Live cluster snapshot: health, nodes, top indices by size
node index.js --tools      # List all 12 available tools with descriptions
```

---

## Available tools

| Tool | What it reveals |
|---|---|
| `cluster_health` | Status, shard counts, pending tasks |
| `cat_allocation` | Per-node disk usage — catches watermark breaches |
| `cat_indices` | Index health, size, doc count — sortable, filterable |
| `cat_shards` | Shard-level state and unassigned reasons |
| `inspect_index` | Deep stats: indexing/search rates, segment count, merge activity |
| `index_settings` | Replica count, refresh interval, ILM policy, codec |
| `query_statistics` | Query cache, fielddata, request cache hit/miss/eviction |
| `ilm_summary` | All ILM policies and their phase configurations |
| `ilm_explain` | Per-index ILM state, step errors, time in phase |
| `node_stats` | JVM heap, GC, thread pool queues, file system, CPU |
| `snapshot_status` | Repository list and snapshot state/size/errors |
| `pending_tasks` | Master node queue — catches cluster state update backlogs |

---

## Adding a tool

Create `src/tools/your_tool.js`:

```js
module.exports = {
  name: 'your_tool',
  description: 'What this reveals and when to use it.',
  parameters: {
    type: 'object',
    properties: {
      index: { type: 'string', description: '...' },
    },
    required: ['index'],
  },
  async execute({ index }, elastic) {
    return elastic.get(`/${index}/_your_endpoint`);
  },
};
```

Then add one line to `src/tools/registry.js`:

```js
const yourTool = require('./your_tool');
const ALL_TOOLS = [ ..., yourTool ];
```

The tool is immediately available to the LLM on the next run.

---

## Technical notes

**Native HTTP only** — `src/llm.js` and `src/elastic.js` use Node's built-in `https`/`http` modules. SSE streaming from the LLM is parsed manually: newline-delimited `data:` frames are accumulated in a buffer, tool call arguments are concatenated across chunks by index, and `onToken`/`onToolStart` callbacks fire as content arrives.

**Planning vs. execution** — The planner makes a single non-streaming call and parses the response as JSON, giving a structured DAG before any tools run. The executor then runs an open-ended agentic loop using streaming calls, letting the LLM decide how many tool rounds are needed based on what it finds.

**Tool call accumulation** — OpenAI-style streaming splits tool call names and JSON arguments across many SSE chunks. The client accumulates `{ id, name, arguments }` by delta index and fires `onToolStart` exactly once per tool, when the name first becomes non-empty.

**Session object** — Every run maintains a `Session` that holds the full OpenAI message array (system → user → assistant → tool → assistant…), evidence entries with timestamps, and export paths. The HTML report is generated directly from the session at the end, so it reflects exactly what the agent saw and did.

---

## Output

Each run produces timestamped files in `./output/`:

- `elastibot_<id>.html` — full dark-theme report with collapsible per-tool evidence tables, stat cards, the streamed analysis, and a risk assessment section
- `<tool>_<ts>.csv` — one CSV per tool that returned an array (e.g. `cat_indices`, `cat_allocation`, `cat_shards`)

---

## License

MIT
