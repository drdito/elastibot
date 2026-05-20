'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

class ElasticClient {
  constructor({ url, apiKey }) {
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  request(method, esPath, body = null) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.baseUrl);
      const secure = u.protocol === 'https:';
      const lib = secure ? https : http;

      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        hostname: u.hostname,
        port: u.port || (secure ? 443 : 80),
        path: (u.pathname.replace(/\/$/, '') + esPath),
        method,
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
        },
        // Allow self-signed certs on local / dev clusters.
        rejectUnauthorized: process.env.ES_TLS_VERIFY !== 'false',
      };

      const req = lib.request(options, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(raw); } catch {
            return reject(new Error(`ES parse error (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
          }
          if (res.statusCode >= 400) {
            const reason = parsed.error?.reason || parsed.error?.type || `HTTP ${res.statusCode}`;
            return reject(new Error(reason));
          }
          resolve(parsed);
        });
      });

      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  get(path)         { return this.request('GET',    path); }
  post(path, body)  { return this.request('POST',   path, body); }
  put(path, body)   { return this.request('PUT',    path, body); }
  del(path)         { return this.request('DELETE', path); }
}

module.exports = { ElasticClient };
