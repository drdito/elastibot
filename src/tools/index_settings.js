'use strict';

module.exports = {
  name: 'index_settings',
  description:
    'Retrieve index settings: number_of_replicas, number_of_shards, refresh_interval, ' +
    'ILM policy name, codec, routing, and any custom settings. Use include_defaults for full picture.',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'string',
        description: 'Index name or wildcard pattern.',
      },
      include_defaults: {
        type: 'boolean',
        description: 'Include default settings (verbose but comprehensive).',
      },
    },
    required: ['index'],
  },
  async execute({ index, include_defaults = false }, elastic) {
    const q = include_defaults ? '?include_defaults=true' : '';
    return elastic.get(`/${index}/_settings${q}`);
  },
};
