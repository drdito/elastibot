'use strict';

class Session {
  constructor({ issue, model }) {
    this.id        = Date.now().toString(36);
    this.issue     = issue;
    this.model     = model;
    this.startedAt = new Date();
    this.messages  = [];      // OpenAI message array (system/user/assistant/tool)
    this.evidence  = [];      // { tool, params, result, timestamp }
    this.exports   = [];      // { type: 'html'|'csv', path }
  }

  addMessage(msg)            { this.messages.push(msg); return this; }
  addEvidence(entry)         { this.evidence.push({ ...entry, timestamp: new Date().toISOString() }); return this; }
  addExport(type, filePath)  { this.exports.push({ type, path: filePath }); return this; }

  get duration() { return ((Date.now() - this.startedAt.getTime()) / 1000).toFixed(1); }
}

module.exports = { Session };
