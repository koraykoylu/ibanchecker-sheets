const IBC_API = "https://ibanchecker.cash/api/v1/validate";
const IBC_KEY_PROP = "IBANCHECKER_API_KEY";
const IBC_REMAINING_PROP = "IBANCHECKER_REMAINING";
const IBC_CACHE_SECONDS = 21600;
const IBC_BATCH = 50;
const IBC_FORMULA_MAX = 300;
const IBC_FORMULA_MS = 25000;
const IBC_MENU_MS = 300000;
const IBC_MENU_MAX_ROWS = 5000;

/**
 * Whether each IBAN is valid, checked by ibanchecker.cash.
 *
 * @param {A2:A100} ibans A cell or a range of IBANs.
 * @return TRUE for a valid IBAN, FALSE for an invalid one.
 * @customfunction
 */
function IBAN_VALID(ibans) {
  return ibcFormula_(ibans, "valid");
}

/**
 * Why each IBAN is invalid; empty for a valid IBAN.
 *
 * @param {A2:A100} ibans A cell or a range of IBANs.
 * @return The reason the IBAN failed, or an empty cell.
 * @customfunction
 */
function IBAN_ERROR(ibans) {
  return ibcFormula_(ibans, "error");
}

/**
 * The bank behind each IBAN.
 *
 * @param {A2:A100} ibans A cell or a range of IBANs.
 * @return The bank's name.
 * @customfunction
 */
function IBAN_BANK(ibans) {
  return ibcFormula_(ibans, "bank");
}

/**
 * The BIC (SWIFT code) of the bank behind each IBAN.
 *
 * @param {A2:A100} ibans A cell or a range of IBANs.
 * @return The bank's BIC.
 * @customfunction
 */
function IBAN_BIC(ibans) {
  return ibcFormula_(ibans, "bic");
}

/**
 * Validity, error, country, bank and BIC of each IBAN, in five columns.
 *
 * @param {A2:A100} ibans A cell or a single column of IBANs.
 * @return Five columns: valid, error, country, bank, BIC.
 * @customfunction
 */
function IBAN_CHECK(ibans) {
  const grid = ibcGrid_(ibans);
  const recs = ibcFormulaLookup_(grid.rows);
  return grid.rows.map((row) => ibcCheckRow_(recs[ibcClean_(row[0])]));
}

function onInstall(e) {
  onOpen(e);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem("Check selected IBANs", "ibcCheckSelection")
    .addItem("Settings and API key", "ibcShowSidebar")
    .addToUi();
}

function ibcFormula_(input, field) {
  const grid = ibcGrid_(input);
  const recs = ibcFormulaLookup_(grid.rows);
  const out = grid.rows.map((row) => row.map((cell) => ibcCell_(field, recs[ibcClean_(cell)])));
  return grid.single ? out[0][0] : out;
}

function ibcFormulaLookup_(rows) {
  const key = ibcKey_();
  if (!key) throw new Error(IBC_MSG.noKey);
  const result = ibcLookup_(ibcUnique_(rows), key, Date.now() + IBC_FORMULA_MS, IBC_FORMULA_MAX);
  if (result.tooMany) throw new Error(IBC_MSG.tooMany);
  if (result.auth) throw new Error(IBC_MSG.badKey);
  if (result.quota && result.charged === 0 && result.cached === 0) throw new Error(IBC_MSG.quota);
  return result.records;
}

function ibcKey_() {
  return PropertiesService.getUserProperties().getProperty(IBC_KEY_PROP);
}

function ibcCacheKey_(iban) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `ibc1:${iban}`);
  return digest.map((b) => ((b & 0xff) + 0x100).toString(16).slice(1)).join("");
}

function ibcLookup_(ibans, key, deadline, maxUncached) {
  const cache = CacheService.getUserCache();
  const records = {};
  const cacheKeys = {};
  ibans.forEach((iban) => (cacheKeys[iban] = ibcCacheKey_(iban)));

  const hits = {};
  for (let i = 0; i < ibans.length; i += 100) {
    const chunk = ibans.slice(i, i + 100).map((iban) => cacheKeys[iban]);
    Object.assign(hits, cache.getAll(chunk));
  }

  const pending = [];
  ibans.forEach((iban) => {
    const hit = hits[cacheKeys[iban]];
    if (hit) records[iban] = JSON.parse(hit);
    else pending.push(iban);
  });

  const result = { records, cached: ibans.length - pending.length, sent: 0, charged: 0, auth: false, quota: false, tooMany: false, unfinished: 0 };
  if (maxUncached && pending.length > maxUncached) {
    result.tooMany = true;
    return result;
  }

  let remaining = null;
  for (let i = 0; i < pending.length; i += IBC_BATCH) {
    const batch = pending.slice(i, i + IBC_BATCH);
    if (result.auth || result.quota || Date.now() > deadline) {
      const kind = result.auth ? "auth" : result.quota ? "quota" : "later";
      batch.forEach((iban) => (records[iban] = { kind }));
      if (kind === "later") result.unfinished += batch.length;
      continue;
    }
    const responses = UrlFetchApp.fetchAll(
      batch.map((iban) => ({
        url: IBC_API,
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ iban }),
        headers: { Authorization: `Bearer ${key}`, "User-Agent": `ibanchecker-sheets/${IBC_VERSION}` },
        muteHttpExceptions: true,
      }))
    );
    const fresh = {};
    responses.forEach((res, j) => {
      const iban = batch[j];
      let body = null;
      try {
        body = JSON.parse(res.getContentText());
      } catch (err) {
        body = null;
      }
      const rec = ibcRecord_(res.getResponseCode(), body);
      records[iban] = rec;
      result.sent += 1;
      if (rec.kind === "ok") {
        result.charged += 1;
        fresh[cacheKeys[iban]] = JSON.stringify(rec);
        const left = ibcHeader_(res.getHeaders(), "X-RateLimit-Remaining");
        if (left !== null && (remaining === null || Number(left) < remaining)) remaining = Number(left);
      }
      if (rec.kind === "auth") result.auth = true;
      if (rec.kind === "quota") {
        result.quota = true;
        remaining = 0;
      }
    });
    if (Object.keys(fresh).length) cache.putAll(fresh, IBC_CACHE_SECONDS);
  }

  if (remaining !== null) {
    try {
      PropertiesService.getUserProperties().setProperty(
        IBC_REMAINING_PROP,
        JSON.stringify({ remaining, at: new Date().toISOString() })
      );
    } catch (err) {
      // A formula may not be allowed to write properties; the count is only a hint for the sidebar.
    }
  }
  result.remaining = remaining;
  return result;
}

function ibcCheckSelection() {
  const ui = SpreadsheetApp.getUi();
  const key = ibcKey_();
  if (!key) {
    ibcShowSidebar();
    return;
  }
  const range = SpreadsheetApp.getActiveRange();
  if (!range) {
    ui.alert("Select the cells that hold the IBANs, then run Check selected IBANs again.");
    return;
  }
  const rows = range.getNumRows();
  if (rows > IBC_MENU_MAX_ROWS) {
    ui.alert(`Select at most ${IBC_MENU_MAX_ROWS.toLocaleString("en-US")} rows at a time; Google stops a run after six minutes.`);
    return;
  }

  const sheet = range.getSheet();
  const top = range.getRow();
  let outCol = range.getColumn() + range.getNumColumns();
  const values = sheet.getRange(top, range.getColumn(), rows, 1).getValues();
  if (!values.some((row) => ibcClean_(row[0]))) {
    ui.alert("No IBANs in the first selected column.");
    return;
  }

  const lastNeeded = outCol + IBC_CHECK_HEADERS.length - 1;
  if (lastNeeded > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), lastNeeded - sheet.getMaxColumns());
  }
  let target = sheet.getRange(top, outCol, rows, IBC_CHECK_HEADERS.length);
  if (!ibcIsEmpty_(target)) {
    const answer = ui.alert(
      "The five columns to the right already hold data",
      "Insert five new columns for the results? Nothing in the sheet is overwritten.",
      ui.ButtonSet.YES_NO
    );
    if (answer !== ui.Button.YES) return;
    sheet.insertColumnsBefore(outCol, IBC_CHECK_HEADERS.length);
    target = sheet.getRange(top, outCol, rows, IBC_CHECK_HEADERS.length);
  }

  SpreadsheetApp.getActive().toast("Checking IBANs…", "IBAN Checker", -1);
  const result = ibcLookup_(ibcUnique_(values), key, Date.now() + IBC_MENU_MS, 0);
  if (result.auth) {
    SpreadsheetApp.getActive().toast("", "IBAN Checker", 1);
    ui.alert(IBC_MSG.badKey);
    return;
  }

  ibcWriteHeaders_(sheet, top, range.getColumn(), outCol);
  target.setValues(values.map((row) => ibcCheckRow_(result.records[ibcClean_(row[0])])));

  const checked = values.filter((row) => ibcClean_(row[0])).length;
  const lines = [`${checked.toLocaleString("en-US")} IBANs checked.`];
  if (result.cached) lines.push(`${result.cached.toLocaleString("en-US")} were checked in the last six hours and not charged again.`);
  if (result.remaining !== null && result.remaining !== undefined) {
    lines.push(`${result.remaining.toLocaleString("en-US")} requests left on your key this month.`);
  }
  SpreadsheetApp.getActive().toast(lines.join(" "), "IBAN Checker", 10);
  if (result.quota) ui.alert(`${IBC_MSG.quota}. The rows after the limit are marked.`);
  else if (result.unfinished) {
    ui.alert(`Google's time limit stopped the run with ${result.unfinished.toLocaleString("en-US")} IBANs left; they are marked. Select them and run it again.`);
  }
}

function ibcIsEmpty_(range) {
  return (
    range.getValues().every((row) => row.every((v) => v === "")) &&
    range.getFormulas().every((row) => row.every((f) => f === ""))
  );
}

function ibcWriteHeaders_(sheet, top, ibanCol, outCol) {
  if (top < 2) return;
  const above = String(sheet.getRange(top - 1, ibanCol).getValue());
  if (!above || /\d/.test(above)) return;
  const header = sheet.getRange(top - 1, outCol, 1, IBC_CHECK_HEADERS.length);
  if (ibcIsEmpty_(header)) header.setValues([IBC_CHECK_HEADERS]);
}

function ibcShowSidebar() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("IBAN Checker"));
}

function ibcSettings() {
  const props = PropertiesService.getUserProperties();
  const key = props.getProperty(IBC_KEY_PROP);
  let usage = null;
  try {
    usage = JSON.parse(props.getProperty(IBC_REMAINING_PROP) || "null");
  } catch (err) {
    usage = null;
  }
  return { hasKey: !!key, hint: ibcKeyHint_(key), usage, version: IBC_VERSION };
}

function ibcSaveKey(input) {
  const key = String(input || "").trim();
  if (!ibcKeyShape_(key)) {
    throw new Error("That is not an ibanchecker.cash API key: keys start with iban_ followed by letters and digits.");
  }
  const props = PropertiesService.getUserProperties();
  props.setProperty(IBC_KEY_PROP, key);
  props.deleteProperty(IBC_REMAINING_PROP);
  return ibcSettings();
}

function ibcRemoveKey() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty(IBC_KEY_PROP);
  props.deleteProperty(IBC_REMAINING_PROP);
  return ibcSettings();
}
