'use strict';

const DEFAULT_MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || '20', 10);

class Session {
  constructor({ issue, model, maxIterations } = {}) {
    this.id            = Date.now().toString(36);
    this.issue         = issue;
    this.model         = model;
    this.startedAt     = new Date();
    this.messages      = [];      // OpenAI message array (system/user/assistant/tool)
    this.evidence      = [];      // { tool, params, result, timestamp }
    this.exports       = [];      // { type: 'html'|'csv', path }
    this.dag           = [];      // { step, tool, rationale, result, timestamp }
    this.maxIterations = maxIterations != null ? maxIterations : DEFAULT_MAX_ITERATIONS;
  }

  addMessage(msg)            { this.messages.push(msg); return this; }
  addEvidence(entry)         { this.evidence.push({ ...entry, timestamp: new Date().toISOString() }); return this; }
  addExport(type, filePath)  { this.exports.push({ type, path: filePath }); return this; }
  addDagNode(node)           { this.dag.push({ ...node, timestamp: new Date().toISOString() }); return this; }

  get duration() { return ((Date.now() - this.startedAt.getTime()) / 1000).toFixed(1); }
}

module.exports = { Session };
