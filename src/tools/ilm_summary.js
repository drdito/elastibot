'use strict';

module.exports = {
  name: 'ilm_summary',
  description:
    'List ILM (Index Lifecycle Management) policies and their configured phases ' +
    '(hot/warm/cold/frozen/delete) with actions and timings.',
  parameters: {
    type: 'object',
    properties: {
      policy: {
        type: 'string',
        description: 'Specific policy name to inspect. Omit to list all policies.',
      },
    },
    required: [],
  },
  async execute({ policy = '' } = {}, elastic) {
    const target = policy ? `/${policy}` : '';
    return elastic.get(`/_ilm/policy${target}`);
  },
};
