// A small stand-in for the Apps Script services the add-on uses, so Core.js and Code.js run unchanged in Node.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

export function fakeResponse(status, body, headers = {}) {
  return {
    getResponseCode: () => status,
    getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
    getHeaders: () => headers,
  };
}

// Answers like the API: the test decides per IBAN.
export function fakeApi(answer) {
  const calls = [];
  return {
    calls,
    fetchAll(requests) {
      return requests.map((req) => {
        const { iban } = JSON.parse(req.payload);
        calls.push({ iban, auth: req.headers.Authorization });
        return answer(iban, calls.length);
      });
    },
  };
}

export function liveApi() {
  const calls = [];
  return {
    calls,
    fetchAll(requests) {
      return requests.map((req) => {
        calls.push(JSON.parse(req.payload).iban);
        const out = execFileSync(
          "curl",
          ["-s", "-D", "-", "-X", "POST", req.url, "-H", "Content-Type: application/json", "-H", `Authorization: ${req.headers.Authorization}`, "--data", req.payload],
          { encoding: "utf8" }
        );
        const split = out.indexOf("\r\n\r\n");
        const head = out.slice(0, split).split("\r\n");
        const status = Number(head[0].split(" ")[1]);
        const headers = {};
        head.slice(1).forEach((line) => {
          const i = line.indexOf(":");
          headers[line.slice(0, i)] = line.slice(i + 1).trim();
        });
        return fakeResponse(status, out.slice(split + 4), headers);
      });
    },
  };
}

export class FakeSheet {
  constructor(rows) {
    this.cells = rows.map((r) => r.slice());
    this.width = Math.max(...this.cells.map((r) => r.length));
    this.cells.forEach((r) => {
      while (r.length < this.width) r.push("");
    });
  }
  getMaxColumns() {
    return this.width;
  }
  insertColumnsBefore(col, n) {
    this.cells.forEach((r) => r.splice(col - 1, 0, ...Array(n).fill("")));
    this.width += n;
  }
  insertColumnsAfter(col, n) {
    this.insertColumnsBefore(col + 1, n);
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (col + numCols - 1 > this.width) throw new Error("The coordinates of the range are outside the dimensions of the sheet.");
    while (this.cells.length < row + numRows - 1) this.cells.push(Array(this.width).fill(""));
    return new FakeRange(this, row, col, numRows, numCols);
  }
  column(col) {
    return this.cells.map((r) => r[col - 1]);
  }
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getSheet() {
    return this.sheet;
  }
  getRow() {
    return this.row;
  }
  getColumn() {
    return this.col;
  }
  getNumRows() {
    return this.numRows;
  }
  getNumColumns() {
    return this.numCols;
  }
  getValues() {
    return this.sheet.cells.slice(this.row - 1, this.row - 1 + this.numRows).map((r) => r.slice(this.col - 1, this.col - 1 + this.numCols));
  }
  getValue() {
    return this.getValues()[0][0];
  }
  getFormulas() {
    return this.getValues().map((r) => r.map(() => ""));
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) throw new Error("setValues: wrong dimensions");
    values.forEach((r, i) => r.forEach((v, j) => (this.sheet.cells[this.row - 1 + i][this.col - 1 + j] = v)));
  }
}

export function loadAddon({ api, key = null, sheet = null, selection = null, alertAnswer = "YES" } = {}) {
  const props = {};
  if (key) props.IBANCHECKER_API_KEY = key;
  const cache = {};
  const alerts = [];
  const toasts = [];
  let sidebarShown = false;

  const context = {
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (alg, text) => [...createHash(alg).update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    CacheService: {
      getUserCache: () => ({
        getAll: (keys) => Object.fromEntries(keys.filter((k) => k in cache).map((k) => [k, cache[k]])),
        putAll: (entries) => Object.assign(cache, entries),
      }),
    },
    PropertiesService: {
      getUserProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => (props[k] = String(v)),
        deleteProperty: (k) => delete props[k],
      }),
    },
    UrlFetchApp: { fetchAll: (reqs) => api.fetchAll(reqs) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle: () => ({}) }) },
    SpreadsheetApp: {
      getActiveRange: () => selection,
      getActive: () => ({ toast: (msg) => toasts.push(msg) }),
      getUi: () => ({
        ButtonSet: { YES_NO: "YES_NO" },
        Button: { YES: "YES", NO: "NO" },
        alert: (...args) => {
          alerts.push(args.join(" | "));
          return alertAnswer;
        },
        showSidebar: () => (sidebarShown = true),
        createAddonMenu: () => ({ addItem() { return this; }, addToUi() {} }),
      }),
    },
  };
  vm.createContext(context);
  for (const file of ["Core.js", "Code.js"]) {
    vm.runInContext(readFileSync(SRC + file, "utf8"), context, { filename: file });
  }
  return {
    run: (expr) => vm.runInContext(expr, context),
    call: (name, ...args) => context[name](...args),
    props,
    cache,
    alerts,
    toasts,
    sidebarShown: () => sidebarShown,
    sheet,
  };
}
