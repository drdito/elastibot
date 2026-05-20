'use strict';

module.exports = {
  name: 'inspect_index',
  description:
    'Deep stats for a single index: document count, deleted docs, store size, segment count, ' +
    'search rate, indexing rate, merge activity, refresh time, and flush stats.',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'string',
        description: 'Exact index name (no wildcards).',
      },
    },
    required: ['index'],
  },
  async execute({ index }, elastic) {
    const [stats, segments] = await Promise.all([
      elastic.get(`/${index}/_stats`),
      elastic.get(`/${index}/_segments`),
    ]);
    return {
      index,
      docs:      stats._all?.primaries?.docs,
      store:     stats._all?.primaries?.store,
      indexing:  stats._all?.primaries?.indexing,
      search:    stats._all?.primaries?.search,
      merges:    stats._all?.primaries?.merges,
      refresh:   stats._all?.primaries?.refresh,
      flush:     stats._all?.primaries?.flush,
      segments:  segments._shards,
    };
  },
};
