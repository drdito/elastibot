'use strict';

module.exports = {
  name: 'snapshot_status',
  description:
    'Inspect snapshot repositories and snapshots. Lists repositories (no args), or shows snapshots ' +
    'for a given repository including state, start/end time, size, and failed shard counts.',
  parameters: {
    type: 'object',
    properties: {
      repository: {
        type: 'string',
        description: 'Repository name. Omit to list all registered repositories.',
      },
      snapshot: {
        type: 'string',
        description: 'Snapshot name or pattern (e.g. "_all", "snap-2024-*"). Requires repository.',
      },
    },
    required: [],
  },
  async execute({ repository = '', snapshot = '' } = {}, elastic) {
    if (!repository) return elastic.get('/_snapshot');
    if (snapshot)    return elastic.get(`/_snapshot/${repository}/${snapshot}`);
    return elastic.get(`/_snapshot/${repository}/_all?verbose=false`);
  },
};
