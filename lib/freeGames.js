const axios = require('axios');
const { getGameDetails, isMultiplayer, MULTIPLAYER_CATEGORY_IDS } = require('./gameSearch');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache = null;
let cachedAt = 0;

async function getFreeMultiplayerGames() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  let items = [];
  try {
    const res = await axios.get('https://store.steampowered.com/search/results/', {
      params: { sort_by: 'Reviews_DESC', tags: 113, json: 1, count: 100 },
      timeout: 15000,
    });
    items = (res.data?.items || []).map(i => {
      const m = i.logo?.match(/\/steam\/apps\/(\d+)\//);
      return m ? { appId: parseInt(m[1], 10), name: i.name } : null;
    }).filter(Boolean);
  } catch (err) {
    console.error('Free games list fetch error:', err.message);
    return cache || [];
  }

  const games = [];
  await Promise.all(items.map(async ({ appId, name: searchName }) => {
    const details = await getGameDetails(appId);
    // Skip only if type is explicitly a non-game (DLC, etc); unknown type (old cache) passes through
    if (!details || (details.type && details.type !== 'game') || !isMultiplayer(details)) return;
    games.push({
      appId,
      name: details.name || searchName,
      headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      storeUrl: `https://store.steampowered.com/app/${appId}/`,
      categories: (details.categories || [])
        .filter(c => MULTIPLAYER_CATEGORY_IDS.has(c.id))
        .map(c => c.description),
      free: true,
    });
  }));

  games.sort((a, b) => a.name.localeCompare(b.name));
  cache = games;
  cachedAt = Date.now();
  return games;
}

module.exports = { getFreeMultiplayerGames };
