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

To replace the data later:
1. Download a new CSV (All) file using the same settings.
2. Replace the relevant team, player, or goalie CSV in this folder with the new file.
3. Run: python3 scripts/update_tracker.py --refresh-nst-only

Source: https://www.naturalstattrick.com/teamtable.php
        https://www.naturalstattrick.com/playerteams.php
