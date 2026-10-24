# Marketplace store listing

The text entered in the Google Workspace Marketplace SDK, kept here so the listing and the help page can be compared.

## Application name (50 max)

IBAN Checker by ibanchecker.cash

## Short description (200 max)

Check IBANs in Google Sheets: formulas for validity, bank and BIC, or a whole column at once, with the same validation engine as ibanchecker.cash.

## Detailed description (16,000 max)

IBAN Checker checks a column of IBANs where it already lives: whether each one is valid, why it failed, its country, its bank and the bank's BIC. Each IBAN is validated by the ibanchecker.cash API, the same engine as the ibanchecker.cash website, national check digits included, so a spreadsheet and the website never disagree about an IBAN.

Formulas. Each takes a single cell or a range and returns a result of the same shape:
=IBAN_VALID(A2:A100) gives TRUE or FALSE.
=IBAN_ERROR(A2:A100) gives the reason an IBAN failed, and stays empty for a valid one.
=IBAN_BANK(A2:A100) gives the bank's name.
=IBAN_BIC(A2:A100) gives the bank's BIC.
=IBAN_CHECK(A2:A100) gives five columns: valid, error, country, bank, BIC.

Check selected IBANs. For a long supplier or customer list, select the IBANs and run Check selected IBANs from the add-on menu. The results are written as values in the five columns next to the selection. Nothing is overwritten: if those columns hold data, the add-on asks first and inserts new columns instead.

What you need. An ibanchecker.cash API key. A free key is available at ibanchecker.cash/api-docs; each IBAN checked counts as one request on the key, and paid plans raise the monthly limit. Results are kept for six hours in your own Google account, so a recalculation does not count again.

Privacy. The add-on reads only the cells you pass to a formula or select, and sends those values to the ibanchecker.cash API, which validates them in memory and stores none of them. It cannot open your other files, and we receive nothing else from your Google account. The source code is public under the MIT license at github.com/koraykoylu/ibanchecker-sheets.

## Category

Accounting and Finance

## Pricing

Free of charge with paid features

## URLs

- Terms of service: https://ibanchecker.cash/terms
- Privacy policy: https://ibanchecker.cash/privacy
- Support: https://ibanchecker.cash/contact
- Help: https://ibanchecker.cash/integrations/google-sheets
- Report an issue: https://ibanchecker.cash/contact
- Developer website: https://ibanchecker.cash

## Graphics

- Icons: `assets/icon-32.png`, `assets/icon-48.png`, `assets/icon-96.png`, `assets/icon-128.png` (the ibanchecker.cash mark with a 12 px margin on a 264 px canvas, transparent background)
- Card banner: `assets/banner-220x140.png` (the site's logo lockup on white)
- Screenshots: 1280x800, taken from the add-on running in a real spreadsheet
