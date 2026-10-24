# IBAN Checker for Google Sheets

Google Sheets add-on for the [ibanchecker.cash](https://ibanchecker.cash) IBAN validation API. It checks a column of IBANs in place: whether each one is valid, why it failed, its country, its bank and the bank's BIC.

Validation is done by the ibanchecker.cash API, the same engine as the website, national check digits included, so a sheet and the site never disagree about an IBAN. No IBAN is stored or logged by the API.

## Install

From the Google Workspace Marketplace (listing pending Google's review), then in any spreadsheet open **Extensions > IBAN Checker by ibanchecker.cash > Settings and API key** and paste your key. A free key is available at [ibanchecker.cash/api-docs](https://ibanchecker.cash/api-docs).

## Formulas

Every formula takes a single cell or a range and returns a result of the same shape.

| Formula | Returns |
| --- | --- |
| `=IBAN_VALID(A2:A100)` | `TRUE` or `FALSE` |
| `=IBAN_ERROR(A2:A100)` | why the IBAN failed, empty when it is valid |
| `=IBAN_BANK(A2:A100)` | the bank's name |
| `=IBAN_BIC(A2:A100)` | the bank's BIC |
| `=IBAN_CHECK(A2:A100)` | five columns: valid, error, country, bank, BIC |

Spaces and lower case are accepted. A cell without any digit (a header such as `IBAN`) is skipped and not counted. A valid IBAN whose bank is missing from our directory reads `Not in our bank directory`.

One formula checks at most 300 IBANs that were not checked in the last six hours; for a longer list use the menu command.

## Check selected IBANs

Select the IBANs and run **Extensions > IBAN Checker by ibanchecker.cash > Check selected IBANs**. The results are written as values in the five columns to the right of the selection, with a header row when the selection sits under one. Nothing is overwritten: if those columns hold data the add-on asks first and inserts five new columns instead. Up to 5,000 rows per run.

## What it costs

Each IBAN checked counts as one request on your API key, the same as a call to `POST /api/v1/validate`. The same IBAN appearing several times in one formula or run is sent once. Results are kept for six hours in your own Google account's Apps Script cache, under a SHA-256 hash rather than the IBAN, so checking the same IBAN again within six hours is not counted. Plans and limits: [ibanchecker.cash/pricing](https://ibanchecker.cash/pricing).

## Shared spreadsheets

Google runs a spreadsheet formula with the settings of the spreadsheet's owner, so in a shared sheet the formulas count against the owner's key. The menu command always uses the key of the person who runs it.

## Permissions

The add-on asks Google for three permissions and nothing more:

- `spreadsheets.currentonly`: read and write the spreadsheet it is used in, no other file
- `script.external_request`: send the IBANs to `https://ibanchecker.cash/api/v1/validate`
- `script.container.ui`: show the settings sidebar

The API key is kept in your Google account's user properties, not in the spreadsheet.

## Develop

```bash
npm test
```

The tests run `src/Core.js` and `src/Code.js` unchanged in Node against a small stand-in for the Apps Script services (`test/harness.mjs`), plus one call to production with an unknown key. Set `SHEETS_TEST_API_KEY` to also validate real IBANs against production.

`npm run push` uploads `src/` to the Apps Script project named in `.clasp.json` with [clasp](https://github.com/google/clasp).

## License

MIT
