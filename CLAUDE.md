# Gangs of Lagos: notes for Claude Code

Browser game: TypeScript + Vite + Three.js, single-player, saves in localStorage. See `README.md` for
what is built, controls, the project layout and how to test.

## Content rules

- Original or licensed assets, names, music and designs only. Nothing from GTA, CODM, racing games or other franchises.
- No real officials, real private residences, real businesses or real people as targets or as named locations without written permission.
- Placeholders are allowed but labelled as placeholders, in game and in the README.
- Local-language lines are drafted, then reviewed by native speakers and marked `reviewed: true` before release.
- Never claim a feature works unless it runs in the build and a test covers it.
- Online: server decides money, items and mission results; the browser only sends actions.

## Working rules

- Work one roadmap phase per session and end with a build you can play. No buttons that do nothing.
- Keep Harbour Bend and Marina Point playable, and keep older saves loading: bump `SAVE_VERSION` in `src/save.ts` and extend `migrate()` for any format change.
- Before finishing: `npm run build`, then `npm run preview` and run every script in `tests/` (Python 3 + Playwright). Each prints PASS/FAIL lines.
- Finish with what changed, how to try it, and what remains (including what is still placeholder).
