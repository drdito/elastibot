'use strict';

const fs   = require('fs');
const path = require('path');

function rowsToCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  const escape  = (v) => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ].join('\n');
}

function exportEvidence(evidence, outputDir) {
  const written = [];
  for (const entry of evidence) {
    const csv = rowsToCsv(entry.result);
    if (!csv) continue;
    const name = `${entry.tool}_${Date.now()}.csv`;
    const dest = path.join(outputDir, name);
    fs.writeFileSync(dest, csv, 'utf8');
    written.push(dest);
  }
  return written;
}

module.exports = { exportEvidence, rowsToCsv };
