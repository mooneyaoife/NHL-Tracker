# Round 6.16 — Explicit 2025–26 season access

The generated season index already preserves the complete 2025–26 archive after the tracker rolls forward. This round makes that capability visible and unambiguous.

- Non-current seasons are labelled **Archive** in the season selector.
- When the current season is newer than 2025–26, the top bar shows **Open 2025–26 archive**.
- While viewing 2025–26, the same control becomes **Return to 2026–27** (or whichever season the generated index marks current).
- Switching seasons preserves the current page and other route context while adding or removing only the `season` query parameter.
- The control appears only when the archive is listed by the generated index, so it cannot link to missing data.
- The existing automatic rollover and archive-preservation behaviour is unchanged.
