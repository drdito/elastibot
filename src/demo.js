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

const DEMO_PLAN = {
  summary:    'High disk utilization on data-node-1 (91%) and data-node-2 (88%) is triggering the Elasticsearch high-watermark shard allocation block.',
  hypothesis: 'Two of three data nodes have breached the 90% high-watermark threshold, causing replica shard allocation to fail and turning the cluster yellow.',
  priority:   'high',
  investigation_steps: [
    {
      step: 1, tool: 'cluster_health',
      description: 'Assess overall cluster status and count unassigned shards',
      rationale:   'Establishes baseline — yellow status with unassigned shards is the entry signature for watermark issues.',
      conditions:  { if_positive: 'Drill into node disk usage with cat_allocation', if_negative: 'Broaden investigation scope' },
    },
    {
      step: 2, tool: 'cat_allocation',
      description: 'Inspect per-node disk utilization and shard distribution',
      rationale:   'Will show which specific nodes have crossed watermark thresholds.',
      conditions:  { if_positive: 'Identify affected indices on saturated nodes', if_negative: 'Investigate other allocation causes' },
    },
    {
      step: 3, tool: 'cat_indices',
      description: 'Survey all indices — flag yellow ones and their disk footprint',
      rationale:   'Pinpoints which indices have unassigned replicas and reveals outsized index growth.',
      conditions:  { if_positive: 'Check shard state detail for yellow indices', if_negative: 'Review ILM rollover policy' },
    },
    {
      step: 4, tool: 'cat_shards',
      description: 'Confirm unassigned shard reasons for affected indices',
      rationale:   'The unassigned_details field will confirm HIGH_DISK_WATERMARK as the allocation blocker.',
      conditions:  { if_positive: 'Review ILM policy — rollover size may be too large', if_negative: 'Check replica count settings' },
    },
    {
      step: 5, tool: 'ilm_summary',
      description: 'Review ILM rollover policy thresholds',
      rationale:   'A max_size rollover that is too large lets indices grow past the watermark before rotating.',
      conditions:  { if_positive: 'Recommend tighter rollover + disk expansion', if_negative: 'Recommend manual forcemerge/shrink' },
    },
  ],
};

// Tool calls that play out during demo execution, in order.
const DEMO_SEQUENCE = [
  { name: 'cluster_health', params: { level: 'cluster' },           key: 'cluster_health' },
  { name: 'cat_allocation', params: {},                              key: 'cat_allocation'  },
  { name: 'cat_indices',    params: { sort_by: 'store.size:desc' }, key: 'cat_indices'     },
  { name: 'cat_shards',     params: { state: 'UNASSIGNED' },        key: 'cat_shards'      },
  { name: 'ilm_summary',    params: {},                              key: 'ilm_summary'     },
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
- ILM logs-policy rollover: max_size=50 GB — but indices are reaching 91–97 GB per primary before rolling, indicating the write alias is not triggering rollover correctly

## Root Cause
The high disk watermark (90% by default at cluster.routing.allocation.disk.watermark.high) has been breached on data-node-1 and is imminent on data-node-2. Elasticsearch refuses to allocate new shards — including replicas — to any node above this threshold. The contributing factor is that the ILM rollover condition (max_size: 50 GB) is not being enforced, allowing individual index segments to grow nearly twice as large as intended before a new index is created. This compounded normal data growth to push both nodes over threshold simultaneously.

## Recommendations
1. **Immediate** — Free disk space on nodes 1 and 2. Snapshot then delete indices outside your retention window. As a stopgap, temporarily set replicas to 0 on the two largest yellow indices to allow Elasticsearch to reclaim replica shard space and recover cluster status to green:
   PUT /logs-app-2024.05.16/_settings  { "index": { "number_of_replicas": 0 } }
   PUT /logs-app-2024.05.17/_settings  { "index": { "number_of_replicas": 0 } }
   Restore to 1 after disk usage drops below 80%.

2. **Short-term** — Fix the ILM write alias for logs-app-* to ensure rollover triggers at the configured max_size. Reduce rollover threshold to max_size: 30 GB and add a max_age: 12h safety condition. Verify with: GET /logs-app-*/_ilm/explain

3. **Long-term** — Add alerting at 75% disk usage (before the 85% low-watermark pauses allocation entirely). Expand storage on nodes 1 and 2, or onboard a warm/frozen tier with cheaper object-store-backed searchable snapshots for indices older than 7 days. Target steady-state disk utilization below 70% on all data nodes to absorb ingestion spikes safely.

## Risk Assessment
**HIGH** — data-node-1 is already above the flood-stage watermark (95%) threshold. If ingestion continues unchecked, Elasticsearch will set all index blocks to read-only within hours, halting all writes across every data pipeline feeding this cluster.`;

// ── Demo runner ──────────────────────────────────────────────────────────────

async function runDemo(session, callbacks) {
  for (const call of DEMO_SEQUENCE) {
    // Brief pause between tool calls to feel like real API latency.
    await sleep(500);

    callbacks.onToolStart?.(call.name);
    await sleep(150);
    callbacks.onToolCall?.(call.name, call.params);

    // Simulate ES API response time.
    await sleep(700 + Math.random() * 400);

    const result = MOCK[call.key];
    callbacks.onToolResult?.(call.name, result);
    session.addEvidence({ tool: call.name, params: call.params, result });

    await sleep(250);
  }

  // Pause before the analysis starts — mimics the LLM "thinking" before streaming.
  await sleep(900);

  await typeText(DEMO_ANALYSIS, callbacks.onToken);

  callbacks.onDone?.(DEMO_ANALYSIS);
  return DEMO_ANALYSIS;
}

module.exports = { runDemo, DEMO_PLAN, DEMO_ISSUE, DEMO_ANALYSIS };
