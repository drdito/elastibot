'use strict';

const fs   = require('fs');
const path = require('path');

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cols     = Object.keys(rows[0]);
  const thead    = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const tbody    = rows.map(row =>
    `<tr>${cols.map(c => `<td>${esc(row[c])}</td>`).join('')}</tr>`
  ).join('');
  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function renderEvidence(evidence) {
  if (!evidence.length) return '<p class="muted">No tool calls recorded.</p>';

  return evidence.map((entry, i) => {
    const table = Array.isArray(entry.result) ? renderTable(entry.result) : '';
    const raw   = !table
      ? `<pre>${esc(JSON.stringify(entry.result, null, 2)).slice(0, 4000)}</pre>`
      : '';
    const params = esc(JSON.stringify(entry.params, null, 2));
    return `
    <details${i < 3 ? ' open' : ''}>
      <summary>
        <span class="badge">${esc(entry.tool)}</span>
        <span class="call-num">#${i + 1}</span>
        <span class="ts">${esc(entry.timestamp)}</span>
      </summary>
      <div class="detail-body">
        <div class="params-row"><span class="label-sm">params</span><code>${params}</code></div>
        ${table}${raw}
      </div>
    </details>`;
  }).join('\n');
}

// Convert ##-headed markdown sections to styled HTML — just enough for the analysis block.
function renderAnalysis(text) {
  if (!text) return '<p class="muted">No analysis generated.</p>';
  return esc(text)
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
    .replace(/^(\d+)\. /gm, '<span class="step-num">$1.</span> ')
    .replace(/^- /gm, '• ')
    .replace(/\n/g, '<br>');
}

function generate(session, analysis, outputDir) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Elastibot — ${esc(session.id)}</title>
  <style>
    :root {
      --bg:       #0d1117;
      --surface:  #161b22;
      --surface2: #1c2128;
      --border:   #30363d;
      --text:     #e6edf3;
      --muted:    #8b949e;
      --brand:    #00bfb3;
      --brand-dk: #004d49;
      --red:      #f85149;
      --yellow:   #d29922;
      --green:    #3fb950;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.6; }

    /* ── Header ── */
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 20px 40px; display: flex; align-items: center; gap: 16px; }
    .logo { font-size: 20px; font-weight: 700; color: var(--brand); letter-spacing: -0.5px; }
    .logo span { opacity: 0.5; font-weight: 400; }
    .meta { font-size: 12px; color: var(--muted); margin-left: auto; text-align: right; }

    /* ── Layout ── */
    .container { max-width: 1280px; margin: 0 auto; padding: 32px 40px; }
    section { margin-bottom: 36px; }

    /* ── Section headings ── */
    h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--brand); margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--brand-dk); }

    /* ── Stat cards ── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; }
    .card .val { font-size: 26px; font-weight: 700; color: var(--text); }
    .card .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

    /* ── Issue box ── */
    .issue { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--brand); border-radius: 6px; padding: 14px 18px; color: var(--muted); font-style: italic; }

    /* ── Analysis ── */
    .analysis { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 22px 28px; line-height: 1.9; }
    .analysis h3 { color: var(--brand); font-size: 14px; margin: 20px 0 8px; }
    .analysis h3:first-child { margin-top: 0; }
    .analysis strong { color: var(--text); }
    .analysis .step-num { color: var(--brand); font-weight: 700; }

    /* ── Evidence / details ── */
    details { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; overflow: hidden; }
    details[open] > summary { border-bottom: 1px solid var(--border); }
    summary { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer; user-select: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▶'; font-size: 9px; color: var(--muted); transition: transform 0.15s; flex-shrink: 0; }
    details[open] summary::before { transform: rotate(90deg); }
    .badge { background: var(--brand-dk); color: var(--brand); font-family: 'Consolas', monospace; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .call-num { color: var(--muted); font-size: 11px; }
    .ts { margin-left: auto; font-size: 11px; color: var(--muted); font-family: monospace; }
    .detail-body { padding: 12px 16px; }
    .params-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; font-size: 12px; }
    .label-sm { color: var(--muted); font-size: 10px; text-transform: uppercase; padding-top: 2px; flex-shrink: 0; }
    code { font-family: 'Consolas', monospace; font-size: 11px; color: var(--muted); white-space: pre-wrap; }
    pre { font-family: 'Consolas', monospace; font-size: 11px; color: var(--muted); white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; font-family: 'Consolas', monospace; font-size: 12px; }
    th { background: var(--surface2); color: var(--muted); text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    td { padding: 5px 10px; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: rgba(255,255,255,0.02); }

    .muted { color: var(--muted); }
    footer { text-align: center; color: var(--muted); font-size: 11px; padding: 20px; border-top: 1px solid var(--border); margin-top: 20px; }
  </style>
</head>
<body>
  <header>
    <div class="logo">⚡ Elastibot <span>/ Autonomous Admin Report</span></div>
    <div class="meta">
      Session ${esc(session.id)}<br>
      ${esc(session.startedAt.toISOString())}
    </div>
  </header>

  <div class="container">

    <div class="cards">
      <div class="card"><div class="val">${session.evidence.length}</div><div class="lbl">Tool Calls</div></div>
      <div class="card"><div class="val">${session.duration}s</div><div class="lbl">Duration</div></div>
      <div class="card"><div class="val" style="font-size:16px">${esc(session.model)}</div><div class="lbl">Model</div></div>
      <div class="card"><div class="val">${session.exports.length}</div><div class="lbl">Exports</div></div>
    </div>

    <section>
      <h2>Issue Reported</h2>
      <div class="issue">${esc(session.issue)}</div>
    </section>

    <section>
      <h2>Analysis &amp; Recommendations</h2>
      <div class="analysis">${renderAnalysis(analysis)}</div>
    </section>

    <section>
      <h2>Evidence &mdash; ${session.evidence.length} tool calls</h2>
      ${renderEvidence(session.evidence)}
    </section>

  </div>
  <footer>Generated by Elastibot &middot; ${new Date().toISOString()}</footer>
</body>
</html>`;

  const filename = `elastibot_${session.id}.html`;
  const dest     = path.join(outputDir, filename);
  fs.writeFileSync(dest, html, 'utf8');
  return dest;
}

module.exports = { generate };
