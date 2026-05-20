'use strict';

module.exports = {
  name: 'pending_tasks',
  description:
    'List cluster-level pending tasks (master queue): task source, time in queue, priority, and ' +
    'executing status. Useful for diagnosing master node overload or stuck cluster state updates.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_params, elastic) {
    return elastic.get('/_cluster/pending_tasks');
  },
};
