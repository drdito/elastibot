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
