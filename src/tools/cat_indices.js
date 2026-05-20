'use strict';

module.exports = {
  name: 'cat_indices',
  description:
    'List indices with health, status, primary/replica counts, doc count, deleted docs, store size, and ' +
    'primary store size. Supports filtering by pattern, health colour, and sort column.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Index name or wildcard (e.g. "logs-*", "*"). Defaults to all.',
      },
      health: {
        type: 'string',
        enum: ['green', 'yellow', 'red'],
        description: 'Only show indices with this health status.',
      },
      sort_by: {
        type: 'string',
        description: 'Column + direction (e.g. "store.size:desc", "docs.count:desc"). Default: store.size:desc.',
      },
    },
    required: [],
  },
  async execute({ pattern = '*', health = '', sort_by = 'store.size:desc' } = {}, elastic) {
    let path = `/_cat/indices/${pattern}?format=json&bytes=gb&s=${sort_by}&v`;
    if (health) path += `&health=${health}`;
    return elastic.get(path);
  },
};
