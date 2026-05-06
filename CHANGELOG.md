# Changelog

All notable changes to LanOps Steam Game Finder are documented here.

## [1.1.0.0] - 2026-05-06

### Added
- **Free Multiplayer Games section** — a new always-visible section on the main page shows top free-to-play multiplayer games sourced from Steam, no library overlap required. Results are cached for 6 hours and pre-warmed on server startup.
- **Cumulative playtime sort** — sort common games by total hours all players have combined, in addition to the existing average playtime sort. Available on both the main page and party page.
- **Steam Party system** — create a shareable party link, invite friends to join via Steam login, and find common games as a group in real time.

### Fixed
- Free games endpoint now correctly extracts Steam app IDs from the logo URL (Steam search API does not return an `id` field directly).
- Games with stale cache entries (missing `type` or `name` fields) are no longer incorrectly excluded from free game results; the game name falls back to the search result name.

### Changed
- "Average playtime" sort now correctly ranks by per-player average hours rather than cumulative total.
- Game search logic extracted to `lib/gameSearch.js` and party management to `lib/partyStore.js` for cleaner server architecture.

## [1.0.0] - Initial release

- Find common multiplayer games across multiple Steam accounts
- Supports 64-bit Steam IDs, vanity URLs, and full profile URLs
- Steam login via OAuth for friend picker
- Private/inaccessible account warnings
- Playtime breakdown per player
- Filter and sort results
