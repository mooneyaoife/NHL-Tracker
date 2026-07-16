# Round 6.15 — Personalized player intelligence

## Goal

Turn saved players from a simple list into useful, browser-local analytical context without copying their full player profiles into Home or Workspace.

## What changed

- Every saved player now has a preferred analytical lens: **Recent form**, **Season production** or **Position impact**.
- The preferred lens is stored only in the current browser under `nhl-player-lenses-v1`.
- Workspace presents a compact player dossier with one current value, its context, a restrained visual indicator and a direct route to the underlying evidence.
- Home uses the same preferred lens, so its saved-player module reflects what the user actually wants to monitor.
- Skater impact uses the tracker’s existing six-measure, position-adjusted Natural Stat Trick profile.
- Goalie impact uses qualified five-on-five GSAA percentile context.
- Recent form and production use the existing official game history and season totals.

## Capability improvements

- Players can now be saved or removed directly from the authoritative player profile.
- Workspace’s player search now opens the visible league-search section rather than leaving results in a hidden pane.
- Saved IDs are normalized as strings, preventing number/string mismatches.
- Compare buttons and saved-player stars no longer compete for the same generic event selector.

## Boundaries

- Workspace and Home show context, not a second complete report.
- “Open evidence” routes to the relevant Overview, Impact or Goalie section.
- Impact remains descriptive and retains the existing sample requirements and methodology.
