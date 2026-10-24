import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSheet, fakeApi, fakeResponse, liveApi, loadAddon } from "./harness.mjs";

const KEY = "iban_00000000000000000000000000000000";
const plain = (v) => JSON.parse(JSON.stringify(v));

const VALID = {
  valid: true,
  iban: "DE89370400440532013000",
  formatted: "DE89 3704 0044 0532 0130 00",
  country_name: "Germany",
  bank_name: "Commerzbank",
  bic: "COBADEFFXXX",
};

function answers(map, remaining = 90) {
  return fakeApi((iban, n) => {
    const a = map[iban];
    if (typeof a === "function") return a(n);
    if (a) return fakeResponse(200, a, { "x-ratelimit-remaining": String(remaining - n) });
    return fakeResponse(200, { valid: false, iban, country_name: "Germany", error: "Check digits do not match.", error_code: "INVALID_CHECKSUM" }, { "x-ratelimit-remaining": String(remaining - n) });
  });
}

test("a single cell gives a single value, cleaned of spaces and case", () => {
  const api = answers({ DE89370400440532013000: VALID });
  const addon = loadAddon({ api, key: KEY });
  assert.equal(addon.call("IBAN_VALID", " de89 3704 0044 0532 0130 00 "), true);
  assert.equal(addon.call("IBAN_BANK", "DE89370400440532013000"), "Commerzbank");
  assert.equal(addon.call("IBAN_BIC", "DE89370400440532013000"), "COBADEFFXXX");
  assert.equal(addon.call("IBAN_ERROR", "DE89370400440532013000"), "");
  assert.equal(api.calls.length, 1, "the same IBAN within six hours comes from the cache");
  assert.equal(api.calls[0].auth, `Bearer ${KEY}`);
});

test("a range keeps its shape; empty cells and text without digits are not sent", () => {
  const api = answers({ DE89370400440532013000: VALID });
  const addon = loadAddon({ api, key: KEY });
  const out = addon.call("IBAN_VALID", [["IBAN"], ["DE89370400440532013000"], [""], ["DE00370400440532013000"], ["de89370400440532013000"]]);
  assert.deepEqual(plain(out), [[""], [true], [""], [false], [true]]);
  assert.deepEqual(api.calls.map((c) => c.iban), ["DE89370400440532013000", "DE00370400440532013000"]);
});

test("an invalid IBAN says so in every column, and a bank we do not hold is named as our gap", () => {
  const api = answers({ GB82WEST12345698765432: { ...VALID, iban: "GB82WEST12345698765432", country_name: "United Kingdom", bank_name: null, bic: null } });
  const addon = loadAddon({ api, key: KEY });
  assert.equal(addon.call("IBAN_BANK", "GB82WEST12345698765432"), "Not in our bank directory");
  assert.equal(addon.call("IBAN_BIC", "GB82WEST12345698765432"), "Not in our bank directory");
  assert.equal(addon.call("IBAN_BANK", "DE00370400440532013000"), "Invalid IBAN");
  assert.equal(addon.call("IBAN_ERROR", "DE00370400440532013000"), "Check digits do not match.");
  assert.deepEqual(plain(addon.call("IBAN_CHECK", [["DE00370400440532013000"]])), [[false, "Check digits do not match.", "Germany", "Invalid IBAN", "Invalid IBAN"]]);
});

test("IBAN_CHECK gives five columns per row", () => {
  const api = answers({ DE89370400440532013000: VALID });
  const addon = loadAddon({ api, key: KEY });
  assert.deepEqual(plain(addon.call("IBAN_CHECK", [["DE89370400440532013000"], [""]])), [
    [true, "", "Germany", "Commerzbank", "COBADEFFXXX"],
    ["", "", "", "", ""],
  ]);
});

test("without a key nothing is sent and the formula says where to add one", () => {
  const api = answers({});
  const addon = loadAddon({ api });
  assert.throws(() => addon.call("IBAN_VALID", "DE89370400440532013000"), /Add your ibanchecker.cash API key/);
  assert.equal(api.calls.length, 0);
});

test("a refused key stops the formula after the first batch", () => {
  const api = fakeApi(() => fakeResponse(401, { error: "Invalid or inactive API key.", error_code: "UNAUTHORIZED" }));
  const addon = loadAddon({ api, key: KEY });
  const ibans = Array.from({ length: 120 }, (_, i) => [`DE${String(i).padStart(20, "0")}`]);
  assert.throws(() => addon.call("IBAN_VALID", ibans), /did not accept the API key/);
  assert.equal(api.calls.length, 50, "no request after the batch that was refused");
});

test("a used-up quota: the whole formula fails if nothing was answered, otherwise the rest is marked", () => {
  const capped = fakeApi(() => fakeResponse(429, { error: "Monthly limit reached.", error_code: "QUOTA_EXCEEDED" }));
  assert.throws(() => loadAddon({ api: capped, key: KEY }).call("IBAN_VALID", "DE89370400440532013000"), /Monthly limit/);

  const ibans = Array.from({ length: 60 }, (_, i) => [`DE${String(i).padStart(20, "0")}`]);
  const partial = fakeApi((iban, n) => (n <= 2 ? fakeResponse(200, { ...VALID, iban }, { "X-RateLimit-Remaining": "0" }) : fakeResponse(429, { error_code: "QUOTA_EXCEEDED" })));
  const addon = loadAddon({ api: partial, key: KEY });
  const out = plain(addon.call("IBAN_VALID", ibans));
  assert.equal(out[0][0], true);
  assert.equal(out[1][0], true);
  assert.match(out[2][0], /Monthly limit/);
  assert.match(out[59][0], /Monthly limit/);
  assert.equal(partial.calls.length, 50, "the second batch is never sent");
  assert.equal(JSON.parse(addon.props.IBANCHECKER_REMAINING).remaining, 0);
});

test("a failing service is shown as unreachable and not cached", () => {
  let down = true;
  const api = fakeApi((iban) => (down ? fakeResponse(502, "<html>Bad gateway</html>") : fakeResponse(200, { ...VALID, iban })));
  const addon = loadAddon({ api, key: KEY });
  assert.match(addon.call("IBAN_BANK", "DE89370400440532013000"), /could not be reached/);
  down = false;
  assert.equal(addon.call("IBAN_BANK", "DE89370400440532013000"), "Commerzbank");
  assert.equal(api.calls.length, 2);
});

test("more than 300 new IBANs in one formula points to the menu command", () => {
  const api = answers({});
  const addon = loadAddon({ api, key: KEY });
  const ibans = Array.from({ length: 301 }, (_, i) => [`DE${String(i).padStart(20, "0")}`]);
  assert.throws(() => addon.call("IBAN_VALID", ibans), /More than 300 new IBANs/);
  assert.equal(api.calls.length, 0);
});

test("the remaining count is read from the response headers whatever their case", () => {
  const api = fakeApi((iban) => fakeResponse(200, { ...VALID, iban }, { "X-RateLimit-Remaining": "41" }));
  const addon = loadAddon({ api, key: KEY });
  addon.call("IBAN_VALID", "DE89370400440532013000");
  assert.equal(JSON.parse(addon.props.IBANCHECKER_REMAINING).remaining, 41);
});

test("the cache key is a hash, never the IBAN itself", () => {
  const api = answers({ DE89370400440532013000: VALID });
  const addon = loadAddon({ api, key: KEY });
  addon.call("IBAN_VALID", "DE89370400440532013000");
  const keys = Object.keys(addon.cache);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^[0-9a-f]{64}$/);
  const stored = JSON.stringify(addon.cache).replace(/\s+/g, "");
  assert.ok(!stored.includes("DE89370400440532013000") && !stored.includes("37040044"), "the cached record does not carry the IBAN in any spacing");
});

test("the menu writes five columns and a header next to the selection", () => {
  const sheet = new FakeSheet([["IBAN"], ["DE89370400440532013000"], ["DE00370400440532013000"]]);
  sheet.insertColumnsAfter(1, 5);
  const api = answers({ DE89370400440532013000: VALID });
  const addon = loadAddon({ api, key: KEY, sheet, selection: sheet.getRange(2, 1, 2, 1) });
  addon.call("ibcCheckSelection");
  assert.deepEqual(plain(sheet.cells), [
    ["IBAN", "Valid", "Error", "Country", "Bank", "BIC"],
    ["DE89370400440532013000", true, "", "Germany", "Commerzbank", "COBADEFFXXX"],
    ["DE00370400440532013000", false, "Check digits do not match.", "Germany", "Invalid IBAN", "Invalid IBAN"],
  ]);
  assert.match(addon.toasts.at(-1), /2 IBANs checked\. .*requests left/);
});

test("the menu adds columns when the selection is the last column", () => {
  const sheet = new FakeSheet([["DE89370400440532013000"]]);
  const addon = loadAddon({ api: answers({ DE89370400440532013000: VALID }), key: KEY, sheet, selection: sheet.getRange(1, 1, 1, 1) });
  addon.call("ibcCheckSelection");
  assert.deepEqual(plain(sheet.cells), [["DE89370400440532013000", true, "", "Germany", "Commerzbank", "COBADEFFXXX"]]);
});

test("the menu never overwrites: it asks, and inserts columns on yes", () => {
  const sheet = new FakeSheet([["DE89370400440532013000", "keep me", "", "", "", "", "and me"]]);
  const addon = loadAddon({ api: answers({ DE89370400440532013000: VALID }), key: KEY, sheet, selection: sheet.getRange(1, 1, 1, 1) });
  addon.call("ibcCheckSelection");
  assert.match(addon.alerts[0], /already hold data/);
  assert.deepEqual(plain(sheet.cells), [["DE89370400440532013000", true, "", "Germany", "Commerzbank", "COBADEFFXXX", "keep me", "", "", "", "", "and me"]]);

  const kept = new FakeSheet([["DE89370400440532013000", "keep me"]]);
  kept.insertColumnsAfter(2, 4);
  const api = answers({});
  const refused = loadAddon({ api, key: KEY, sheet: kept, selection: kept.getRange(1, 1, 1, 1), alertAnswer: "NO" });
  refused.call("ibcCheckSelection");
  assert.deepEqual(plain(kept.cells), [["DE89370400440532013000", "keep me", "", "", "", ""]]);
  assert.equal(api.calls.length, 0, "nothing is sent when the user says no");
});

test("the menu without a key opens the settings instead of sending anything", () => {
  const sheet = new FakeSheet([["DE89370400440532013000"]]);
  const api = answers({});
  const addon = loadAddon({ api, sheet, selection: sheet.getRange(1, 1, 1, 1) });
  addon.call("ibcCheckSelection");
  assert.equal(addon.sidebarShown(), true);
  assert.equal(api.calls.length, 0);
});

test("saving a key checks its shape and never shows it back whole", () => {
  const addon = loadAddon({ api: answers({}) });
  assert.throws(() => addon.call("ibcSaveKey", "sk_live_123"), /not an ibanchecker.cash API key/);
  const s = plain(addon.call("ibcSaveKey", ` ${KEY} `));
  assert.equal(addon.props.IBANCHECKER_API_KEY, KEY);
  assert.equal(s.hasKey, true);
  assert.equal(s.hint, "iban_…0000");
  assert.equal(plain(addon.call("ibcRemoveKey")).hasKey, false);
});

test("live: production refuses an unknown key and the formula reports it", () => {
  const api = liveApi();
  const addon = loadAddon({ api, key: KEY });
  assert.throws(() => addon.call("IBAN_VALID", "DE89370400440532013000"), /did not accept the API key/);
  assert.equal(api.calls.length, 1);
});

test("live: a real key validates against production", { skip: !process.env.SHEETS_TEST_API_KEY && "set SHEETS_TEST_API_KEY to run" }, () => {
  const api = liveApi();
  const addon = loadAddon({ api, key: process.env.SHEETS_TEST_API_KEY });
  const out = plain(addon.call("IBAN_CHECK", [["DE89 3704 0044 0532 0130 00"], ["DE00370400440532013000"]]));
  assert.equal(out[0][0], true);
  assert.equal(out[0][2], "Germany");
  assert.match(out[0][3], /Commerzbank/);
  assert.equal(out[0][4], "COBADEFFXXX");
  assert.equal(out[1][0], false);
  assert.ok(out[1][1].length > 0);
  assert.ok(JSON.parse(addon.props.IBANCHECKER_REMAINING).remaining >= 0);
});
