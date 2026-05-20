'use strict';

module.exports = {
  name: 'cluster_health',
  description:
    'Get Elasticsearch cluster health: status (green/yellow/red), node counts, active/unassigned shards, ' +
    'pending tasks, and initializing/relocating shard counts. Optionally drill to index or shard level.',
  parameters: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['cluster', 'indices', 'shards'],
        description: 'Granularity of the response.',
      },
      index: {
        type: 'string',
        description: 'Filter to a specific index pattern (e.g. "logs-*").',
      },
    },
    required: [],
  },
  async execute({ level = 'cluster', index = '' } = {}, elastic) {
    const target = index ? `/${index}` : '';
    return elastic.get(`/_cluster/health${target}?level=${level}&timeout=10s`);
  },
};
