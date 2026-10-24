// Pure logic: no Apps Script service is touched here, so the tests can load this file as it is.

const IBC_VERSION = "0.1.0";

const IBC_MENU = "Extensions > IBAN Checker by ibanchecker.cash";

const IBC_MSG = {
  noKey: `Add your ibanchecker.cash API key: ${IBC_MENU} > Settings and API key. A free key is available at ibanchecker.cash/api-docs`,
  badKey: `ibanchecker.cash did not accept the API key. Check it in ${IBC_MENU} > Settings and API key`,
  quota: "Monthly limit of your API key reached: ibanchecker.cash/pricing",
  unavailable: "ibanchecker.cash could not be reached, try again later",
  later: "Not checked: Google's time limit was reached, run it again",
  tooMany: `More than 300 new IBANs in one formula: select them and use ${IBC_MENU} > Check selected IBANs`,
  invalid: "Invalid IBAN",
  notInDirectory: "Not in our bank directory",
};

const IBC_CHECK_HEADERS = ["Valid", "Error", "Country", "Bank", "BIC"];

function ibcClean_(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, "").toUpperCase();
  // Every IBAN carries check digits, so text without a digit (a header such as "IBAN") is not sent and not charged.
  return /\d/.test(text) ? text : "";
}

function ibcGrid_(input) {
  if (Array.isArray(input)) {
    return { rows: input.map((row) => (Array.isArray(row) ? row : [row])), single: false };
  }
  return { rows: [[input]], single: true };
}

function ibcUnique_(rows) {
  const seen = {};
  const out = [];
  rows.forEach((row) =>
    row.forEach((cell) => {
      const iban = ibcClean_(cell);
      if (iban && !seen[iban]) {
        seen[iban] = true;
        out.push(iban);
      }
    })
  );
  return out;
}

function ibcRecord_(status, body) {
  if (status === 200 && body && typeof body.valid === "boolean") {
    return {
      kind: "ok",
      valid: body.valid,
      error: body.valid ? "" : body.error || IBC_MSG.invalid,
      country: body.country_name || "",
      bank: body.bank_name || "",
      bic: body.bic || "",
    };
  }
  if (status === 401) return { kind: "auth" };
  if (status === 429) return { kind: "quota" };
  return { kind: "unavailable" };
}

function ibcCell_(field, rec) {
  if (!rec) return "";
  if (rec.kind === "quota") return IBC_MSG.quota;
  if (rec.kind === "later") return IBC_MSG.later;
  if (rec.kind !== "ok") return IBC_MSG.unavailable;
  switch (field) {
    case "valid":
      return rec.valid;
    case "error":
      return rec.error;
    case "country":
      return rec.country;
    case "bank":
      if (!rec.valid) return IBC_MSG.invalid;
      return rec.bank || IBC_MSG.notInDirectory;
    case "bic":
      if (!rec.valid) return IBC_MSG.invalid;
      return rec.bic || IBC_MSG.notInDirectory;
    default:
      return "";
  }
}

function ibcCheckRow_(rec) {
  if (!rec) return ["", "", "", "", ""];
  if (rec.kind !== "ok") return [ibcCell_("valid", rec), "", "", "", ""];
  return ["valid", "error", "country", "bank", "bic"].map((field) => ibcCell_(field, rec));
}

function ibcHeader_(headers, name) {
  const wanted = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return null;
}

function ibcKeyShape_(key) {
  return /^iban_[A-Za-z0-9]+$/.test(key);
}

function ibcKeyHint_(key) {
  return key ? `iban_…${key.slice(-4)}` : "";
}
