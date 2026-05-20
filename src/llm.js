'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

class LLMClient {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  _opts(contentLength) {
    const u = new URL(this.baseUrl);
    const secure = u.protocol === 'https:';
    return {
      lib: secure ? https : http,
      reqOpts: {
        hostname: u.hostname,
        port: u.port || (secure ? 443 : 80),
        // Append /chat/completions to whatever path is in baseUrl
        path: (u.pathname.replace(/\/$/, '') + '/chat/completions'),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': contentLength,
        },
      },
    };
  }

  // Non-streaming — used for planning where we need clean JSON back.
  complete(messages, tools = []) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        messages,
        ...(tools.length && { tools, tool_choice: 'auto' }),
      });

      const { lib, reqOpts } = this._opts(Buffer.byteLength(body));

      const req = lib.request(reqOpts, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed.choices[0].message);
          } catch {
            reject(new Error(`LLM parse error (HTTP ${res.statusCode}): ${raw.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Streaming — used for execution so the user sees the analysis live.
  // Returns { content: string, tool_calls: Array }
  // Calls callbacks.onToken(text) and callbacks.onToolStart(name) as chunks arrive.
  stream(messages, tools = [], callbacks = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        ...(tools.length && { tools, tool_choice: 'auto' }),
      });

      const { lib, reqOpts } = this._opts(Buffer.byteLength(body));

      const req = lib.request(reqOpts, (res) => {
        if (res.statusCode !== 200) {
          let err = '';
          res.on('data', c => { err += c; });
          res.on('end', () =>
            reject(new Error(`LLM HTTP ${res.statusCode}: ${err.slice(0, 300)}`))
          );
          return;
        }

        let buf = '';
        let content = '';
        // Accumulate tool calls by index since they arrive across many chunks.
        const tcAccum = {}; // index → { id, name, arguments }

        res.on('data', chunk => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop(); // hold any incomplete trailing line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            let parsed;
            try { parsed = JSON.parse(data); } catch { continue; }

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              callbacks.onToken?.(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!tcAccum[idx]) tcAccum[idx] = { id: '', name: '', arguments: '' };

                if (tc.id) tcAccum[idx].id = tc.id;

                if (tc.function?.name) {
                  const hadName = !!tcAccum[idx].name;
                  tcAccum[idx].name += tc.function.name;
                  // Fire onToolStart exactly once, when the name first arrives.
                  if (!hadName && tcAccum[idx].name) {
                    callbacks.onToolStart?.(tcAccum[idx].name);
                  }
                }

                if (tc.function?.arguments) {
                  tcAccum[idx].arguments += tc.function.arguments;
                }
              }
            }
          }
        });

        res.on('end', () => {
          const tool_calls = Object.values(tcAccum).map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }));
          resolve({ content, tool_calls });
        });

        res.on('error', reject);
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { LLMClient };
