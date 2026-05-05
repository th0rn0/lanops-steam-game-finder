require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const setupAuth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CACHE_FILE = path.join(__dirname, 'cache', 'game-details.json');

// Category IDs that indicate multiplayer capability
const MULTIPLAYER_CATEGORY_IDS = new Set([
  1,  // Multi-player
  9,  // Co-op
  24, // Shared/Split Screen
  27, // Cross-Platform Multiplayer
  36, // Online PvP
  38, // Online Co-op
  47, // Local Co-op
  48, // Local PvP
  49, // PvP
]);

// ── Cache ────────────────────────────────────────────────────────────────────

let gameDetailsCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      gameDetailsCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch {
    gameDetailsCache = {};
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(gameDetailsCache));
  } catch { /* non-fatal */ }
}

loadCache();

// ── Semaphore ─────────────────────────────────────────────────────────────────

class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.count < this.max) { this.count++; return; }
    return new Promise(r => this.queue.push(r));
  }
  release() {
    this.count--;
    if (this.queue.length > 0) {
      this.count++;
      this.queue.shift()();
    }
  }
}

const storeSemaphore = new Semaphore(5);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(session({
  secret: process.env.SESSION_SECRET || 'lanops-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Steam API helpers ─────────────────────────────────────────────────────────

async function resolveVanityUrl(vanity) {
  const res = await axios.get('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/', {
    params: { key: STEAM_API_KEY, vanityurl: vanity },
    timeout: 10000,
  });
  const data = res.data.response;
  if (data.success === 1) return data.steamid;
  return null;
}

async function getPlayerSummaries(steamIds) {
  const res = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
    params: { key: STEAM_API_KEY, steamids: steamIds.join(',') },
    timeout: 10000,
  });
  return res.data.response.players || [];
}

async function getOwnedGames(steamId) {
  const res = await axios.get('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/', {
    params: {
      key: STEAM_API_KEY,
      steamid: steamId,
      include_appinfo: true,
      include_played_free_games: true,
    },
    timeout: 15000,
  });
  return res.data.response || {};
}

async function getGameDetails(appId) {
  const cached = gameDetailsCache[appId];
  if (cached && Date.now() - cached.ts < 30 * 24 * 60 * 60 * 1000) {
    return cached.data;
  }

  await storeSemaphore.acquire();
  try {
    const res = await axios.get('https://store.steampowered.com/api/appdetails', {
      params: { appids: appId, filters: 'categories,name,type' },
      timeout: 10000,
    });
    const entry = res.data?.[appId];
    const data = entry?.success ? entry.data : null;
    gameDetailsCache[appId] = { ts: Date.now(), data };
    return data;
  } catch {
    gameDetailsCache[appId] = { ts: Date.now(), data: null };
    return null;
  } finally {
    storeSemaphore.release();
  }
}

function isMultiplayer(details) {
  if (!details?.categories) return false;
  return details.categories.some(c => MULTIPLAYER_CATEGORY_IDS.has(c.id));
}

async function normaliseSteamInput(raw) {
  const STEAM64_REGEX = /^7656119\d{10}$/;
  const cleaned = raw.trim()
    .replace(/https?:\/\/steamcommunity\.com\/(id|profiles)\//g, '')
    .replace(/\/$/, '');

  if (STEAM64_REGEX.test(cleaned)) return { steamid: cleaned, input: raw.trim() };

  const resolved = await resolveVanityUrl(cleaned).catch(() => null);
  if (resolved) return { steamid: resolved, input: raw.trim(), vanity: cleaned };

  return { steamid: null, input: raw.trim(), error: `Could not resolve "${raw.trim()}"` };
}

// ── Auth routes ───────────────────────────────────────────────────────────────

setupAuth(app, { apiKey: STEAM_API_KEY, baseUrl: BASE_URL });

// ── API: current user ─────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  res.json({ user: req.user || null });
});

// ── API: friends list ─────────────────────────────────────────────────────────

app.get('/api/friends', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const friendsRes = await axios.get('https://api.steampowered.com/ISteamUser/GetFriendList/v1/', {
      params: { key: STEAM_API_KEY, steamid: req.user.steamid, relationship: 'friend' },
      timeout: 10000,
    });

    const friendIds = (friendsRes.data.friendslist?.friends || []).map(f => f.steamid);
    if (!friendIds.length) return res.json({ friends: [] });

    const summaries = [];
    for (let i = 0; i < friendIds.length; i += 100) {
      const players = await getPlayerSummaries(friendIds.slice(i, i + 100));
      summaries.push(...players);
    }

    summaries.sort((a, b) => {
      if (b.personastate !== a.personastate) return b.personastate - a.personastate;
      return a.personaname.localeCompare(b.personaname);
    });

    res.json({
      friends: summaries.map(p => ({
        steamid: p.steamid,
        name: p.personaname,
        avatar: p.avatarmedium,
        online: p.personastate > 0,
      })),
    });
  } catch (err) {
    console.error('Friends fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch friends list.' });
  }
});

// ── SSE: find-games ───────────────────────────────────────────────────────────

app.post('/api/find-games', async (req, res) => {
  const { steamIds: rawInputs } = req.body;

  if (!STEAM_API_KEY) {
    return res.status(500).json({ error: 'STEAM_API_KEY is not configured on the server.' });
  }
  if (!Array.isArray(rawInputs) || rawInputs.filter(Boolean).length < 2) {
    return res.status(400).json({ error: 'Please provide at least 2 Steam IDs.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('progress', { message: 'Resolving Steam IDs…', step: 1, total: 5 });

    const resolved = await Promise.all(
      rawInputs.filter(Boolean).map(normaliseSteamInput)
    );

    const resolutionErrors = resolved.filter(r => !r.steamid);
    const validInputs = resolved.filter(r => r.steamid);

    if (validInputs.length < 2) {
      send('error', { message: 'Could not resolve enough valid Steam IDs to compare.' });
      return res.end();
    }

    const steamIdList = validInputs.map(v => v.steamid);

    send('progress', { message: 'Checking account visibility…', step: 2, total: 5 });

    const players = await getPlayerSummaries(steamIdList);
    const playerMap = Object.fromEntries(players.map(p => [p.steamid, p]));

    const privateAccounts = [];
    const publicAccounts = [];

    for (const { steamid, input, vanity } of validInputs) {
      const player = playerMap[steamid];
      const label = player?.personaname || vanity || input;
      if (!player || player.communityvisibilitystate !== 3) {
        privateAccounts.push({ steamid, name: label, avatar: player?.avatarmedium || null });
      } else {
        publicAccounts.push({ steamid, name: label, avatar: player.avatarmedium });
      }
    }

    send('accounts', { privateAccounts, publicAccounts, resolutionErrors });

    if (publicAccounts.length < 2) {
      send('done', { commonGames: [], message: 'Not enough public accounts to compare.' });
      return res.end();
    }

    send('progress', { message: `Fetching game libraries for ${publicAccounts.length} accounts…`, step: 3, total: 5 });

    const accountLibraries = [];
    const inaccessibleAccounts = [];

    await Promise.all(publicAccounts.map(async account => {
      try {
        const data = await getOwnedGames(account.steamid);
        if (!data.games?.length) {
          inaccessibleAccounts.push(account);
          privateAccounts.push(account);
        } else {
          const gameMap = Object.fromEntries(data.games.map(g => [g.appid, g]));
          accountLibraries.push({ account, gameMap });
        }
      } catch {
        inaccessibleAccounts.push(account);
        privateAccounts.push(account);
      }
    }));

    if (inaccessibleAccounts.length) {
      send('accounts-update', { newPrivateAccounts: inaccessibleAccounts });
    }

    if (accountLibraries.length < 2) {
      send('done', { commonGames: [], message: 'Not enough accessible accounts to compare.' });
      return res.end();
    }

    send('progress', { message: 'Finding common games…', step: 4, total: 5 });

    let commonIds = new Set(Object.keys(accountLibraries[0].gameMap).map(Number));
    for (let i = 1; i < accountLibraries.length; i++) {
      const ids = new Set(Object.keys(accountLibraries[i].gameMap).map(Number));
      commonIds = new Set([...commonIds].filter(id => ids.has(id)));
    }

    const commonIdsArray = [...commonIds];
    send('progress', {
      message: `Found ${commonIdsArray.length} games in common — checking for multiplayer…`,
      step: 5,
      total: 5,
      gameCount: commonIdsArray.length,
    });

    const multiplayerGames = [];
    let checked = 0;
    let lastSave = Date.now();

    await Promise.all(commonIdsArray.map(async appId => {
      const details = await getGameDetails(appId);
      checked++;

      if (checked % 20 === 0) {
        send('checking', { checked, total: commonIdsArray.length });
      }

      if (Date.now() - lastSave > 10000) {
        saveCache();
        lastSave = Date.now();
      }

      if (!isMultiplayer(details)) return;

      const playtimeInfo = accountLibraries.map(({ account, gameMap }) => ({
        name: account.name,
        avatar: account.avatar,
        minutes: gameMap[appId]?.playtime_forever || 0,
        hours: Math.round((gameMap[appId]?.playtime_forever || 0) / 60 * 10) / 10,
      }));

      const totalMinutes = playtimeInfo.reduce((s, p) => s + p.minutes, 0);
      const categories = (details.categories || [])
        .filter(c => MULTIPLAYER_CATEGORY_IDS.has(c.id))
        .map(c => c.description);

      multiplayerGames.push({
        appId,
        name: details.name,
        headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
        storeUrl: `https://store.steampowered.com/app/${appId}/`,
        categories,
        playtimeInfo,
        totalMinutes,
        avgHours: Math.round(totalMinutes / accountLibraries.length / 60 * 10) / 10,
      });
    }));

    saveCache();
    multiplayerGames.sort((a, b) => b.totalMinutes - a.totalMinutes);

    send('done', {
      commonGames: multiplayerGames,
      totalCommon: commonIdsArray.length,
      multiplayerCount: multiplayerGames.length,
    });

  } catch (err) {
    console.error(err);
    send('error', { message: err.message || 'An unexpected error occurred.' });
  }

  res.end();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LanOps Steam Game Finder running at http://localhost:${PORT}`);
    if (!STEAM_API_KEY) {
      console.warn('WARNING: STEAM_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
  });
}

module.exports = { app, isMultiplayer, Semaphore, normaliseSteamInput };
