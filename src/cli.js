'use strict';

const readline = require('readline');

const C = {
  reset:         '\x1b[0m',
  bold:          '\x1b[1m',
  dim:           '\x1b[2m',
  underline:     '\x1b[4m',
  red:           '\x1b[31m',
  green:         '\x1b[32m',
  yellow:        '\x1b[33m',
  blue:          '\x1b[34m',
  magenta:       '\x1b[35m',
  cyan:          '\x1b[36m',
  gray:          '\x1b[90m',
  brightGreen:   '\x1b[92m',
  brightYellow:  '\x1b[93m',
  brightCyan:    '\x1b[96m',
  bgBlue:        '\x1b[44m',
  bgCyan:        '\x1b[46m',
  white:         '\x1b[37m',
};

const TTY = process.stdout.isTTY !== false;
const col = (code, text) => TTY ? `${code}${text}${C.reset}` : text;

function banner() {
  const bar = col(C.cyan, '─'.repeat(62));
  console.log();
  console.log(bar);
  console.log(`  ${col(C.brightCyan + C.bold, '⚡ ELASTIBOT')}   ${col(C.gray, 'Autonomous Elasticsearch Administration Harness')}`);
  console.log(`  ${col(C.gray, 'Model-agnostic  ·  ES/Kibana unified auth  ·  DAG planning')}`);
  console.log(bar);
  console.log();
}

function hr(len = 62) {
  console.log(col(C.gray, '─'.repeat(len)));
}

function phase(n, label) {
  console.log();
  console.log(`  ${col(C.bgBlue + C.white + C.bold, ` Phase ${n} `)}  ${col(C.bold, label)}`);
  console.log();
}

function label(text) {
  console.log(`\n  ${col(C.bold + C.underline, text)}\n`);
}

const print = {
  info:    (msg) => console.log(`  ${col(C.blue,        'ℹ')}  ${msg}`),
  success: (msg) => console.log(`  ${col(C.brightGreen, '✔')}  ${msg}`),
  warn:    (msg) => console.log(`  ${col(C.yellow,      '⚠')}  ${msg}`),
  error:   (msg) => console.error(`  ${col(C.red,       '✖')}  ${msg}`),

  tool: (name, params) => {
    const pStr = params && Object.keys(params).length
      ? `  ${col(C.gray, JSON.stringify(params))}`
      : '';
    console.log(`\n  ${col(C.magenta, '⚙')}  ${col(C.bold, name)}${pStr}`);
  },

  toolResult: (name, result) => {
    const s = JSON.stringify(result);
    const preview = s.length > 140 ? s.slice(0, 137) + '…' : s;
    console.log(`  ${col(C.gray, '└')}  ${col(C.dim, preview)}`);
  },

  toolError: (name, err) => {
    console.log(`  ${col(C.gray, '└')}  ${col(C.red, `error: ${err.message}`)}`);
  },
};

// Inline spinner — uses readline to overwrite the current line on TTY.
class Spinner {
  constructor(label) {
    this.label = label;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.i = 0;
    this.timer = null;
  }

  start() {
    if (!TTY) { console.log(`  … ${this.label}`); return this; }
    process.stdout.write('\n');
    this.timer = setInterval(() => {
      const frame = col(C.cyan, this.frames[this.i++ % this.frames.length]);
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`  ${frame}  ${this.label}`);
    }, 80);
    return this;
  }

  update(text) { this.label = text; }

  _clear() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (TTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
  }

  stop(msg) {
    this._clear();
    if (msg) console.log(`  ${col(C.brightGreen, '✔')}  ${msg}`);
  }

  fail(msg) {
    this._clear();
    if (msg) console.log(`  ${col(C.red, '✖')}  ${msg}`);
  }
}

module.exports = { C, col, TTY, banner, hr, phase, label, print, Spinner };
