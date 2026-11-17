/**
 * A stand-in for the Google services that Code.gs uses, so the backend can run on a laptop:
 * in the tests (Code.test.mjs) and behind the local server used while developing the game
 * (dev-server.mjs). The "spreadsheet" is just arrays in memory.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');

class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    Object.assign(this, { sheet, row, column, rows, columns });
  }

  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.columns }, (_, c) => this.sheet.rows[this.row - 1 + r]?.[this.column - 1 + c] ?? ''),
    );
  }

  setValues(values) {
    values.forEach((line, r) => {
      const target = (this.sheet.rows[this.row - 1 + r] ??= []);
      line.forEach((value, c) => (target[this.column - 1 + c] = value));
    });
    return this;
  }

  setFontWeight() {
    return this;
  }

  setNumberFormat(format) {
    this.sheet.formats.push(format);
    return this;
  }
}

class FakeSheet {
  rows = [];
  formats = [];

  getLastRow() {
    return this.rows.length;
  }

  appendRow(values) {
    this.rows.push([...values]);
  }

  /** Accepts (row, column, rows, columns) like the real thing; A1 ranges are only used for formatting. */
  getRange(row, column = 1, rows = 1, columns = 1) {
    return typeof row === 'string' ? new FakeRange(this, 1, 1, 0, 0) : new FakeRange(this, row, column, rows, columns);
  }

  setFrozenRows() {}
}

/** Load Code.gs into a fresh world with an empty spreadsheet. */
export function loadBackend() {
  const sheets = new Map();
  const cache = new Map();
  const book = {
    getSheetByName: (name) => sheets.get(name) ?? null,
    insertSheet(name) {
      const sheet = new FakeSheet();
      sheets.set(name, sheet);
      return sheet;
    },
  };
  const context = vm.createContext({
    console: { error() {}, log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => void cache.set(key, value),
        remove: (key) => void cache.delete(key),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ getContent: () => text, setMimeType() { return this; } }), // prettier-ignore
    },
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });

  const parse = (output) => JSON.parse(output.getContent());
  return {
    /** Functions defined in Code.gs, for testing them directly. */
    script: context,
    get: (parameter = {}) => parse(context.doGet({ parameter })),
    post: (body) =>
      parse(context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
    /** Rows of a tab, header included. */
    rows: (name) => sheets.get(name)?.rows ?? [],
    sheet: (name) => sheets.get(name),
    /** Forget cached results, as happens by itself after a minute on Google's side. */
    expireCache: () => cache.clear(),
  };
}
