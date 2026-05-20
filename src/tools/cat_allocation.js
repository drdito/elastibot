'use strict';

module.exports = {
  name: 'cat_allocation',
  description:
    'Show disk allocation per data node: shards assigned, disk used (GB), disk available (GB), ' +
    'total disk, and disk percent. Essential for diagnosing disk-watermark breaches and uneven shard distribution.',
  parameters: {
    type: 'object',
    properties: {
      node_id: {
        type: 'string',
        description: 'Filter to a specific node name or ID.',
      },
    },
    required: [],
  },
  async execute({ node_id = '' } = {}, elastic) {
    const target = node_id ? `/${node_id}` : '';
    return elastic.get(`/_cat/allocation${target}?format=json&bytes=gb&v`);
  },
};
