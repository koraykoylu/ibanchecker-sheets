# Changelog

## 0.1.0

First version, submitted to the Google Workspace Marketplace.

- Formulas `IBAN_VALID`, `IBAN_ERROR`, `IBAN_BANK`, `IBAN_BIC` and `IBAN_CHECK`, each taking a cell or a range
- Menu command **Check selected IBANs** that writes the results as values next to the selection and never overwrites a cell
- Settings sidebar for the API key, which is kept in the user's Google account
- Results cached for six hours in the user's own Apps Script cache under a SHA-256 hash, so a recalculation does not count again
