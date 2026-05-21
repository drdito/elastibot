'use strict';

// ── Utilities ───────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Simulates a streaming LLM by feeding text in small chunks with a delay.
async function typeText(text, onToken, chunkSize = 3, delayMs = 16) {
  for (let i = 0; i < text.length; i += chunkSize) {
    await sleep(delayMs);
    onToken(text.slice(i, i + chunkSize));
  }
}

// ── Mock Elasticsearch API responses ────────────────────────────────────────

const MOCK = {
  cluster_health: {
    cluster_name:                  'prod-es-cluster',
    status:                        'yellow',
    number_of_nodes:               3,
    number_of_data_nodes:          3,
    active_primary_shards:         233,
    active_shards:                 245,
    relocating_shards:             2,
    initializing_shards:           0,
    unassigned_shards:             12,
    number_of_pending_tasks:       3,
    task_max_waiting_in_queue_millis: 1420,
    active_shards_percent_as_number: 95.3,
  },

  cat_allocation: [
    { node: 'data-node-1', shards: '82', 'disk.indices': '847.3gb', 'disk.used': '912.4gb', 'disk.avail': '87.6gb',  'disk.total': '1000gb', 'disk.percent': '91', ip: '10.0.1.11' },
    { node: 'data-node-2', shards: '79', 'disk.indices': '821.1gb', 'disk.used': '889.2gb', 'disk.avail': '110.8gb', 'disk.total': '1000gb', 'disk.percent': '88', ip: '10.0.1.12' },
    { node: 'data-node-3', shards: '84', 'disk.indices': '412.0gb', 'disk.used': '455.3gb', 'disk.avail': '544.7gb', 'disk.total': '1000gb', 'disk.percent': '45', ip: '10.0.1.13' },
  ],

  cat_indices: [
    { health: 'yellow', status: 'open', index: 'logs-app-2024.05.17', pri: '5', rep: '1', 'docs.count': '48291033', 'store.size': '182.3gb', pri_store_size: '91.2gb'  },
    { health: 'yellow', status: 'open', index: 'logs-app-2024.05.16', pri: '5', rep: '1', 'docs.count': '51003211', 'store.size': '194.1gb', pri_store_size: '97.0gb'  },
    { health: 'green',  status: 'open', index: 'logs-app-2024.05.15', pri: '5', rep: '1', 'docs.count': '49876543', 'store.size': '188.8gb', pri_store_size: '94.4gb'  },
    { health: 'yellow', status: 'open', index: 'metrics-2024.05.17',  pri: '3', rep: '1', 'docs.count': '9203441',  'store.size': '88.4gb',  pri_store_size: '44.2gb'  },
    { health: 'green',  status: 'open', index: 'metrics-2024.05.16',  pri: '3', rep: '1', 'docs.count': '8997612',  'store.size': '86.1gb',  pri_store_size: '43.0gb'  },
    { health: 'green',  status: 'open', index: 'metrics-2024.05.15',  pri: '3', rep: '1', 'docs.count': '9114200',  'store.size': '87.0gb',  pri_store_size: '43.5gb'  },
    { health: 'green',  status: 'open', index: '.kibana_1',           pri: '1', rep: '1', 'docs.count': '1204',     'store.size': '0.2gb',   pri_store_size: '0.1gb'   },
  ],

  cat_shards: [
    { index: 'logs-app-2024.05.17', shard: '0', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'NODE_LEFT',  unassigned_details: 'HIGH_DISK_WATERMARK', store: '91.2gb' },
    { index: 'logs-app-2024.05.17', shard: '2', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'NODE_LEFT',  unassigned_details: 'HIGH_DISK_WATERMARK', store: '91.2gb' },
    { index: 'logs-app-2024.05.17', shard: '4', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'NODE_LEFT',  unassigned_details: 'HIGH_DISK_WATERMARK', store: '91.2gb' },
    { index: 'logs-app-2024.05.16', shard: '1', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'ALLOCATION_FAILED', unassigned_details: 'HIGH_DISK_WATERMARK', store: '97.0gb' },
    { index: 'logs-app-2024.05.16', shard: '3', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'ALLOCATION_FAILED', unassigned_details: 'HIGH_DISK_WATERMARK', store: '97.0gb' },
    { index: 'metrics-2024.05.17',  shard: '0', prirep: 'r', state: 'UNASSIGNED', node: 'UNASSIGNED', unassigned_reason: 'ALLOCATION_FAILED', unassigned_details: 'HIGH_DISK_WATERMARK', store: '44.2gb' },
    { index: 'logs-app-2024.05.17', shard: '0', prirep: 'p', state: 'STARTED',    node: 'data-node-3', store: '91.2gb' },
    { index: 'logs-app-2024.05.17', shard: '1', prirep: 'p', state: 'STARTED',    node: 'data-node-1', store: '91.2gb' },
    { index: 'logs-app-2024.05.17', shard: '2', prirep: 'p', state: 'STARTED',    node: 'data-node-2', store: '91.2gb' },
    { index: 'logs-app-2024.05.16', shard: '0', prirep: 'p', state: 'STARTED',    node: 'data-node-2', store: '97.0gb' },
    { index: 'logs-app-2024.05.16', shard: '2', prirep: 'p', state: 'STARTED',    node: 'data-node-1', store: '97.0gb' },
    { index: 'metrics-2024.05.17',  shard: '0', prirep: 'p', state: 'STARTED',    node: 'data-node-3', store: '44.2gb' },
  ],

  ilm_summary: {
    'logs-policy': {
      version:       3,
      modified_date: '2024-01-15T09:00:00.000Z',
      policy: {
        phases: {
          hot:    { min_age: '0ms', actions: { rollover: { max_size: '50gb', max_age: '1d' }, set_priority: { priority: 100 } } },
          warm:   { min_age: '7d',  actions: { allocate: { number_of_replicas: 1 }, forcemerge: { max_num_segments: 1 }, set_priority: { priority: 50 } } },
          cold:   { min_age: '30d', actions: { freeze: {}, set_priority: { priority: 0 } } },
          delete: { min_age: '90d', actions: { delete: {} } },
        },
      },
    },
  },
};

// ── Demo scenario definition ─────────────────────────────────────────────────

const DEMO_ISSUE =
  'Disk usage is high on node1 and node2. Several indices are showing yellow health status ' +
  'and we have multiple unassigned shards. Need to understand root cause and immediate remediation steps.';

// Hypothesis-only plan — no upfront step list.
const DEMO_PLAN = {
  summary:    'High disk utilization on data-node-1 (91%) and data-node-2 (88%) is triggering the Elasticsearch high-watermark shard allocation block.',
  hypothesis: 'Two of three data nodes have breached the 90% high-watermark threshold, causing replica shard allocation to fail and turning the cluster yellow.',
  priority:   'high',
};

// Reasoning text the model streams before choosing each tool (simulates thinking aloud).
const DEMO_REASONING = {
  cluster_health:
    'The cluster is reporting yellow health and unassigned shards. ' +
    'Let me start with a baseline health check to establish how many shards are affected.',
  cat_allocation:
    '12 unassigned shards — and they are all replicas. ' +
    'Disk pressure is the most likely cause. I will check per-node allocation to find which nodes have crossed the high-watermark.',
  cat_indices:
    'data-node-1 is at 91%, data-node-2 at 88%. ' +
    'The default high-watermark is 90%, so node-1 has already breached it. ' +
    'I need to see which specific indices have unassigned replicas to scope the impact.',
  conclude:
    'Three yellow indices with replica failures caused by HIGH_DISK_WATERMARK on nodes 1 and 2. ' +
    'Primary shards are intact. I have enough evidence — writing the final report now.',
};

// Demo executes 3 tool calls then concludes early (demonstrates early-exit path).
const DEMO_SEQUENCE = [
  { name: 'cluster_health', params: { level: 'cluster' },           key: 'cluster_health' },
  { name: 'cat_allocation', params: {},                              key: 'cat_allocation'  },
  { name: 'cat_indices',    params: { sort_by: 'store.size:desc' }, key: 'cat_indices'     },
];

const DEMO_ANALYSIS = `## Summary
The cluster is in yellow state due to replica shard allocation failures caused by disk exhaustion on two of three data nodes. data-node-1 is at 91% disk utilization and data-node-2 is at 88% — both at or above Elasticsearch's default high-watermark (90%). As a result, 12 replica shards across three recent log and metrics indices cannot be assigned. All primary shards remain healthy on data-node-3 and are split across nodes 1 and 2, so data is intact and reads are operational. The cluster is degraded but not down.

## Evidence
- Cluster status: **yellow** — 245 active shards, **12 unassigned** (all replicas), 2 relocating
- data-node-1: 912 GB / 1 TB — **91% disk** (above high-watermark of 90%)
- data-node-2: 889 GB / 1 TB — **88% disk** (approaching high-watermark)
- data-node-3: 455 GB / 1 TB — **45% disk** (healthy, absorbing primaries)
- 3 yellow indices: logs-app-2024.05.17 (182 GB), logs-app-2024.05.16 (194 GB), metrics-2024.05.17 (88 GB)
- All unassigned shard reasons: HIGH_DISK_WATERMARK via NODE_LEFT / ALLOCATION_FAILED

## Root Cause
The high disk watermark (90%) has been breached on data-node-1 and is imminent on data-node-2. Elasticsearch refuses to allocate new shards — including replicas — to any node above this threshold.

## Recommendations
1. **Immediate** — Free disk space on nodes 1 and 2. Snapshot then delete indices outside your retention window. Temporarily set replicas to 0 on the two largest yellow indices to recover cluster status to green.
2. **Short-term** — Fix the ILM write alias for logs-app-* to ensure rollover triggers at the configured max_size. Reduce threshold to max_size: 30 GB and add a max_age: 12h safety condition.
3. **Long-term** — Add alerting at 75% disk usage. Expand storage on nodes 1 and 2, or onboard a warm tier with searchable snapshots for indices older than 7 days.

## Risk Assessment
**HIGH** — data-node-1 is already above the flood-stage watermark (95%) threshold. If ingestion continues unchecked, Elasticsearch will set all index blocks to read-only within hours, halting all writes across every data pipeline feeding this cluster.`;

// ── Demo runner ──────────────────────────────────────────────────────────────

async function runDemo(session, callbacks) {
  for (let i = 0; i < DEMO_SEQUENCE.length; i++) {
    const call = DEMO_SEQUENCE[i];

    // Stream model reasoning — shows "model reasons" before each tool choice.
    await sleep(400);
    const reasoning = DEMO_REASONING[call.name] || '';
    if (reasoning && callbacks.onToken) {
      await typeText(reasoning, callbacks.onToken);
    }
    await sleep(300);

    // Signal a tool is about to start (lets the UI close any open content line).
    callbacks.onToolStart?.(call.name);

    // Show the investigation step being added to the DAG.
    const dagNode = { step: i + 1, tool: call.name, rationale: reasoning };
    callbacks.onStep?.(dagNode, i + 1);

    callbacks.onToolCall?.(call.name, call.params);

    // Simulate ES API response time.
    await sleep(700 + Math.random() * 400);

    const result = MOCK[call.key];
    callbacks.onToolResult?.(call.name, result);
    session.addEvidence({ tool: call.name, params: call.params, result });
    session.addDagNode({ ...dagNode, result });

    await sleep(350);
  }

  // Stream conclude reasoning, then fire the early-exit conclude.
  await sleep(400);
  const concludeReasoning = DEMO_REASONING.conclude;
  if (concludeReasoning && callbacks.onToken) {
    await typeText(concludeReasoning, callbacks.onToken);
  }
  await sleep(600);

  callbacks.onConclude?.(DEMO_ANALYSIS);
  callbacks.onDone?.(DEMO_ANALYSIS);
  return DEMO_ANALYSIS;
}

module.exports = { runDemo, DEMO_PLAN, DEMO_ISSUE, DEMO_ANALYSIS };
