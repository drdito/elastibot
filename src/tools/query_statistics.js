'use strict';

module.exports = {
  name: 'query_statistics',
  description:
    'Get cache and query performance stats: query cache hit/miss/eviction counts, fielddata ' +
    'memory usage and evictions, request cache stats, and search latency. Useful for diagnosing ' +
    'heap pressure and slow queries.',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'string',
        description: 'Index name or pattern. Omit for cluster-wide stats.',
      },
      metric: {
        type: 'string',
        enum: ['query_cache', 'fielddata', 'request_cache', 'search', 'indexing', 'all'],
        description: 'Specific metric group to return. Default: all.',
      },
    },
    required: [],
  },
  async execute({ index = '', metric = 'all' } = {}, elastic) {
    const target  = index  ? `/${index}` : '';
    const segment = metric !== 'all' ? `/${metric}` : '';
    return elastic.get(`${target}/_stats${segment}`);
  },
};
