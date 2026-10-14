# Directory deployment audit

Scope: the incremental `preview.html` improvement. The production `index.html` is unchanged. This audit preserves the existing design, record content, embedded assets and storage keys.

## Fixes

- Greeting and topic edits survive reopening an email draft. Topic changes update generated follow-up text while preserving custom edits.
- Downloaded offline guides clear personal details, open draft content and saved-list state, and reopen on Directory.
- Known in-person locations remain correctly labeled and filtered when only the schedule needs confirmation.
- Placement totals ignore incomplete rows. Invalid feeds preserve the last valid data; failed requests release their timeout.
- Corrupt or unavailable browser storage recovers without crashing. Drafts accurately report when persistence is unavailable.
- Shared links from a downloaded guide point to the public website.
- Keyboard focus stays visible after removing saved records or resetting filters. No-JavaScript tabs support native keyboard navigation.
- Older Safari dialog fallback blocks the background, traps focus and closes with Escape.
- Pagination and the university affiliation have valid accessibility semantics. Source links have larger touch targets; long record text wraps on narrow phones.
- Route parameters reject inherited object keys and untrusted text remains escaped.

## Verification

The browser regression suite is `tests/browser-audit.cjs`. GitHub Actions runs it in Chromium, Firefox and WebKit, using Playwright 1.64.0 and axe-core 4.14.0. It covers:

- Directory, search, filters, pagination, deadlines, record details and public sharing at 320, 390, 768, 1024 and 1440 px.
- Saving, reload persistence, comparison, CSV export and saved-list JSON export/import.
- Email drafting, mailto generation, template copy/reset, private-state removal from offline downloads and print preparation.
- All 429 records at phone and desktop widths, including their evidence notes and 693 source-link references.
- No-JavaScript keyboard navigation at every tested width; simulated pre-native-dialog Safari behavior; storage and clipboard failures; cached placement recovery; deadline expiration at FSU midnight; escaped untrusted text.
- Automated accessibility checks across the main views, dialogs and no-JavaScript directory. The suite fails on any reported axe violation or unexpected browser exception.

The four JSON payloads are byte-identical to the previous preview: `research-data`, `guide-meta`, `email-templates` and `placements-config`. Production `index.html` retains SHA-256 `883297e6192ba6697d0ed69b8e1c4cd31a362d9e08e99fb6d61e1c48724ae02c`.

No frontend dependencies or additional external services were introduced. Audit dependencies run only in development/CI. Preview remains `noindex`.

## Evidence and limits

All three browser jobs passed on commit `0ee7c2c`: **45 completed check groups**, **zero automated accessibility violations**, and **zero unexpected browser exceptions**. The final local Chromium run also passed.

[Successful cross-browser run and downloadable screenshots/reports](https://github.com/macin123/cells-research/actions/runs/38501900599).

Source URLs and record dates were validated structurally. This audit does not recertify the current availability of each research opportunity or prove every external source URL is reachable. The execution environment could not retrieve the live Google Sheet CSV; placement parsing, failure handling and caching were tested with controlled feed responses. Actual Sheet sharing settings, live form submission and physical-device keyboard behavior remain external checks.

The audited preview can be reviewed at <https://macin123.github.io/cells-research/preview.html>. Promotion to `index.html` remains a separate step; remove the preview-only `noindex` meta tag when promoting.
