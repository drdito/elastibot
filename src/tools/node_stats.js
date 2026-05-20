'use strict';

module.exports = {
  name: 'node_stats',
  description:
    'Detailed per-node statistics: JVM heap used/max, GC counts and time, thread pool ' +
    'queue/rejected counts, file system free/total, CPU percent, OS load average, ' +
    'and network byte counts.',
  parameters: {
    type: 'object',
    properties: {
      node_id: {
        type: 'string',
        description: 'Node name, ID, or "_local". Omit for all nodes.',
      },
      metrics: {
        type: 'string',
        description:
          'Comma-separated metric groups to include: jvm, os, process, fs, thread_pool, indices, transport. ' +
          'Omit for all metrics.',
      },
    },
    required: [],
  },
  async execute({ node_id = '', metrics = '' } = {}, elastic) {
    const nodeSegment   = node_id ? `/${node_id}` : '';
    const metricSegment = metrics ? `/${metrics}` : '';
    return elastic.get(`/_nodes${nodeSegment}/stats${metricSegment}`);
  },
};
