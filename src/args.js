'use strict';

// Extracts --thinking-level N from argv. Returns the integer or null.
function parseThinkingLevel(argv) {
  const idx = argv.indexOf('--thinking-level');
  if (idx === -1) return null;
  const val = parseInt(argv[idx + 1], 10);
  return isNaN(val) || val < 1 ? null : val;
}

module.exports = { parseThinkingLevel };
