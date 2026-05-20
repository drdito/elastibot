'use strict';

module.exports = {
  name: 'ilm_explain',
  description:
    'Explain the current ILM lifecycle state of indices: phase, action, step, age, ' +
    'step duration, and any step errors. Use only_errors to surface stuck indices quickly.',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'string',
        description: 'Index name or wildcard pattern.',
      },
      only_errors: {
        type: 'boolean',
        description: 'Return only indices with ILM errors or warnings.',
      },
      only_managed: {
        type: 'boolean',
        description: 'Return only ILM-managed indices.',
      },
    },
    required: ['index'],
  },
  async execute({ index, only_errors = false, only_managed = true }, elastic) {
    const params = [];
    if (only_errors)   params.push('only_errors=true');
    if (only_managed)  params.push('only_managed=true');
    const qs = params.length ? `?${params.join('&')}` : '';
    return elastic.get(`/${index}/_ilm/explain${qs}`);
  },
};
