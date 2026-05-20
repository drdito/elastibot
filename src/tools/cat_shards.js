'use strict';

module.exports = {
  name: 'cat_shards',
  description:
    'List shard-level details: which node each shard lives on, state (STARTED/UNASSIGNED/RELOCATING), ' +
    'size, doc count, and unassigned reason/details. Critical for diagnosing allocation problems.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Index pattern to filter (e.g. "logs-*"). Defaults to all.',
      },
      state: {
        type: 'string',
        enum: ['STARTED', 'INITIALIZING', 'RELOCATING', 'UNASSIGNED'],
        description: 'Filter by shard state.',
      },
    },
    required: [],
  },
  async execute({ pattern = '*', state = '' } = {}, elastic) {
    let path = `/_cat/shards/${pattern}?format=json&bytes=gb&s=state,index&v`;
    if (state) path += `&state=${state}`;
    return elastic.get(path);
  },
};
