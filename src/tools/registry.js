'use strict';

const clusterHealth    = require('./cluster_health');
const catIndices       = require('./cat_indices');
const catShards        = require('./cat_shards');
const catAllocation    = require('./cat_allocation');
const inspectIndex     = require('./inspect_index');
const indexSettings    = require('./index_settings');
const queryStatistics  = require('./query_statistics');
const ilmSummary       = require('./ilm_summary');
const ilmExplain       = require('./ilm_explain');
const nodeStats        = require('./node_stats');
const snapshotStatus   = require('./snapshot_status');
const pendingTasks     = require('./pending_tasks');

// Meta-tool intercepted by the executor before ES dispatch.
// The LLM calls this when it has enough evidence to write the final report.
const conclude = {
  name: 'conclude',
  description: 'Call this when you have sufficient evidence to write your final report. Pass your complete markdown analysis as the `report` argument. This ends the investigation immediately.',
  parameters: {
    type: 'object',
    properties: {
      report: {
        type: 'string',
        description: 'Full markdown final report (## Summary, ## Evidence, ## Root Cause, ## Recommendations, ## Risk Assessment)',
      },
    },
    required: ['report'],
  },
  // Never reaches dispatch — the executor intercepts conclude before calling dispatch().
  async execute() {
    throw new Error('conclude is handled by the executor and must not be dispatched');
  },
};

const ALL_TOOLS = [
  clusterHealth,
  catIndices,
  catShards,
  catAllocation,
  inspectIndex,
  indexSettings,
  queryStatistics,
  ilmSummary,
  ilmExplain,
  nodeStats,
  snapshotStatus,
  pendingTasks,
  conclude,
];

// OpenAI-compatible tool definitions passed to the LLM.
const toolDefs = ALL_TOOLS.map(t => ({
  type: 'function',
  function: {
    name:        t.name,
    description: t.description,
    parameters:  t.parameters,
  },
}));

// Name → execute function map for the executor.
const toolMap = Object.fromEntries(ALL_TOOLS.map(t => [t.name, t.execute]));

async function dispatch(name, params, elastic) {
  const fn = toolMap[name];
  if (!fn) throw new Error(`Unknown tool: "${name}". Available: ${Object.keys(toolMap).join(', ')}`);
  return fn(params, elastic);
}

module.exports = { toolDefs, dispatch, ALL_TOOLS };
