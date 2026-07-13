NATURAL STAT TRICK TEAM DATA

This folder stores the manually downloaded Natural Stat Trick team export.

Current export settings:
- Season: 2025-2026
- Season type: Regular Season
- Situation: 5v5 Score & Venue Adjusted
- Score: All Scores
- Rate: Counts
- Team: All Teams
- Export button: CSV (All)

The player export uses the same season and regular-season settings with:
- Page: Players > Individual
- Situation: 5v5
- Position: Skaters
- Team: All Teams
- Export button: CSV (All)

The goalie export uses the same season and regular-season settings with:
- Page: Players > Goalies
- Situation: 5v5
- Team: All Teams
- Rate: Counts
- Export button: CSV (All)

To replace the data later, use the Natural Stat Trick Refresh Centre on the
website's Status page. It provides season-aware links, validates all three CSVs,
and prepares one naturalstattrick-refresh.json file. Upload that file to this
folder and commit it; the normal GitHub workflow deploys the refreshed data.

The three canonical CSV files remain supported as a fallback. A refresh JSON
package is used only when its season matches the tracker's active season.

Source: https://www.naturalstattrick.com/teamtable.php
        https://www.naturalstattrick.com/playerteams.php
