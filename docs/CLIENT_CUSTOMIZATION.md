# Client appearance and reuse

EvalBoard supports an installation identity and browser display preferences without changing the evaluation engine. The actual workspace name, roles, report provenance, and release thresholds still come from the API.

## Deployment defaults

Set these in `apps/web/.env.local` before building the web app:

```dotenv
VITE_BRAND_NAME=Atlas Quality
VITE_BRAND_TAGLINE=Decisions with a trace.
VITE_BRAND_ACCENT=forest
```

Names are limited to 40 characters and taglines to 100. Supported palettes are `ocean`, `forest`, and `iris`; unknown deployment palettes fall back to ocean. Vite embeds these values at build time. They are public display settings; never put credentials in `VITE_*` variables.

## Browser preferences

Open **Appearance** in the console. Edit the name and tagline, choose an accent, switch between comfortable and compact rows, and choose the initial desktop sidebar state. The preview is illustrative and contains no evaluation data. **Apply appearance** applies and saves these settings for this browser origin. The browser override also changes the login identity and document title.

Preferences are local to a browser origin, rather than a workspace or user account. Other people and installations are unaffected. The UI reports when browser storage is blocked and applies preferences for the current session. **Preview defaults** loads the deployment defaults into the form; **Apply appearance** confirms the change.

## Light, Dark, and System

The keyboard-accessible **Theme** selector is available in the top bar, login screen, Appearance page, and case inspector. New browsers start in **Dark**. **System** follows live operating-system color-scheme changes; explicit Light/Dark selections ignore them. Selecting a theme preserves routes, searches, unsaved forms, open inspectors, and API query state.

Theme preference is stored separately as `evalboard.theme.v1`, accepting only `light`, `dark`, or `system`. Missing, invalid, or inaccessible storage falls back to Dark. Blocked writes still apply the selection for the current session and show a storage message. Existing `evalboard.appearance.v1` identity/density files retain their original contract; importing/exporting identity does not change theme preference.

`public/theme-init.js` is a same-origin blocking script in the document head, ahead of the application bundle. `public/theme-base.css` supplies the initial canvas and native `color-scheme`. This prevents the opposite theme from painting while the bundle loads and works with `script-src 'self'`, without inline script, `eval`, or a CSP relaxation. Host these two assets alongside the app; the complete app's deployment CSP still needs to account for its existing development tooling and styling.

`src/themes.css` owns semantic canvas/surface/text/border/action/status/chart tokens, with light and dark values for every palette. Adjust semantic roles for client reuse instead of replacing individual page colors. Graph axes, plotted means, legends, and JSON panels use those tokens. Images are not inverted or filtered; report JSON/Markdown download behavior is unchanged. Print styles use a neutral light canvas.

## Import and export

**Export applied appearance** downloads the current applied settings. Unapplied form changes are not exported. The file contains only display settings:

```json
{
  "version": 1,
  "appearance": {
    "name": "Atlas Quality",
    "tagline": "Decisions with a trace.",
    "accent": "forest",
    "density": "compact",
    "collapsed": false
  }
}
```

Import validates the version, field types, lengths, and known palettes/densities. Files over 16 KB are rejected. A valid import populates the preview and requires **Apply appearance** before changing the workbench. Invalid files leave the applied appearance intact. No file is transmitted to a server.

## Reusing an evaluation workflow

The experiment builder provides three editable scope presets: a development quick check, a full held-out release comparison, and a repeated development sample. Each changes only the split, case limit, repetition count, and experiment budget. Existing name, dataset, candidate configurations, and gate selections stay selected. A readiness checklist shows the minimum inputs before starting.

Presets are convenient starting points, not statistical power calculations or guaranteed provider cost limits. Agree on representative cases, task metrics, failure policy, reviewer independence, release thresholds, and a bounded provider budget for each client. A template is not evidence of model quality. Candidate configurations and gates remain API-backed workspace records.

## Handoff checklist

1. Set client deployment defaults and remove local browser overrides when validating them.
2. Replace the synthetic dataset with an approved, representative version and verify held-out separation.
3. Configure adapters and credentials on the server, review endpoint allowlists, and test bounded execution.
4. Define the release gate with the client; include human review requirements and documented limits.
5. Verify login/role restrictions, mobile navigation, reports, retention, HTTPS, PostgreSQL, and backups using [HANDOVER.md](HANDOVER.md) and [OPERATIONS.md](OPERATIONS.md).

This appearance layer does not provide server-side theme administration, custom logos/fonts, or per-workspace appearance synchronization. The backend security and deployment limitations in the existing handover continue to apply.
