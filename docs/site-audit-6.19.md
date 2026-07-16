# Site audit 6.19 — truthful Tonight slate

## Finding

The NHL `schedule/now` response contains a multi-date week. The tracker treated all of those games as one Tonight slate, producing 43 games beneath the date 29 September even though only five belonged to that NHL slate date.

## Change

- The data generator now selects one authoritative date from the multi-date response.
- The NHL scoreboard's `currentDate` is used when games exist for it.
- The NHL's grouped slate date remains authoritative for late games that begin after midnight UTC.
- If that date has no games, the tracker advances to the nearest playable future date; only after the window has passed does it retain the latest available slate.
- Home and Tonight receive the same single-date dataset.
- Future fallback language now says **Next NHL slate** and **Open next slate** rather than describing future games as the latest or current window.

## Capability boundaries

- No games are removed from the season calendar or Game Centre.
- Tonight remains the authoritative single-slate view.
- The complete season remains available through Season and Game Library.
- Live refresh still detects games inside its pregame-to-postgame time window from the selected NHL date.
- Matchup comparison and Game Centre actions remain available on every displayed game.

## Verification

- Three new regression tests cover exact-date selection, next-playable-date fallback and NHL-date preservation after midnight UTC.
- All 18 tests pass.
- A real tracker regeneration reduced the 29 September slate from 43 games across eight dates to the correct five games on one NHL date.
- Home displayed two featured games with **Next NHL slate** language.
- Tonight displayed five cards, five rail positions, one followed game and the future-slate notice.
- Mobile and dark-mode states were checked at 390 × 844; viewport and theme were reset afterward.
