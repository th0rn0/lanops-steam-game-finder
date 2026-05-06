require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const setupAuth = require('./auth');
const { runGameSearch, isMultiplayer, normaliseSteamInput: _normaliseSteamInput, Semaphore } = require('./lib/gameSearch');
const { getFreeMultiplayerGames } = require('./lib/freeGames');
const partyStore = require('./lib/partyStore');

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Backwards-compatible wrapper — binds the server's API key so callers don't need to pass it
function normaliseSteamInput(raw) {
  return _normaliseSteamInput(raw, STEAM_API_KEY);
}

// ── Party SSE broadcast ───────────────────────────────────────────────────────

const partyConnections = new Map(); // partyId -> Set<res>

function broadcastToParty(partyId, event, data) {
  const conns = partyConnections.get(partyId);
  if (!conns) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try { res.write(msg); } catch {}
  }
}

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

// ── Steam API helper (friends only — game search is in lib/gameSearch) ────────

async function getPlayerSummaries(steamIds) {
  const res = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
    params: { key: STEAM_API_KEY, steamids: steamIds.join(',') },
    timeout: 10000,
  });
  return res.data.response.players || [];
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

// ── SSE: find-games (main page) ───────────────────────────────────────────────

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

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await runGameSearch(rawInputs, STEAM_API_KEY, send);
  } catch (err) {
    console.error(err);
    send('error', { message: err.message || 'An unexpected error occurred.' });
  }

  res.end();
});

// ── API: party CRUD ───────────────────────────────────────────────────────────

app.post('/api/party', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required to create a party.' });
  const party = partyStore.createParty(req.user);
  res.json({ id: party.id, url: `${BASE_URL}/party/${party.id}` });
});

app.get('/api/party/:id', (req, res) => {
  const party = partyStore.getParty(req.params.id);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });
  res.json(party);
});

app.post('/api/party/:id/join', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required to join a party.' });
  const party = partyStore.addMember(req.params.id, req.user);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });
  broadcastToParty(req.params.id, 'member-joined', { member: req.user });
  res.json(party);
});

app.post('/api/party/:id/leave', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  const party = partyStore.removeMember(req.params.id, req.user.steamid);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });
  broadcastToParty(req.params.id, 'member-left', { steamid: req.user.steamid });
  res.json({ ok: true });
});

app.delete('/api/party/:id', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  const party = partyStore.getParty(req.params.id);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });
  if (party.ownerId !== req.user.steamid) return res.status(403).json({ error: 'Only the party owner can delete it.' });
  partyStore.deleteParty(req.params.id);
  broadcastToParty(req.params.id, 'party-deleted', {});
  res.json({ ok: true });
});

// ── SSE: party member events ──────────────────────────────────────────────────

app.get('/api/party/:id/events', (req, res) => {
  const party = partyStore.getParty(req.params.id);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!partyConnections.has(req.params.id)) {
    partyConnections.set(req.params.id, new Set());
  }
  partyConnections.get(req.params.id).add(res);

  // Send current party state immediately
  res.write(`event: state\ndata: ${JSON.stringify(party)}\n\n`);

  // Keep-alive ping every 25s to prevent proxy timeouts
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const conns = partyConnections.get(req.params.id);
    if (conns) {
      conns.delete(res);
      if (!conns.size) partyConnections.delete(req.params.id);
    }
  });
});

// ── SSE: party game search ────────────────────────────────────────────────────

app.get('/api/party/:id/games', async (req, res) => {
  const party = partyStore.getParty(req.params.id);
  if (!party) return res.status(404).json({ error: 'Party not found or expired.' });

  if (!STEAM_API_KEY) {
    return res.status(500).json({ error: 'STEAM_API_KEY is not configured on the server.' });
  }
  if (party.members.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 members to find common games.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const memberIds = party.members.map(m => m.steamid);
    await runGameSearch(memberIds, STEAM_API_KEY, send);
  } catch (err) {
    console.error(err);
    send('error', { message: err.message || 'An unexpected error occurred.' });
  }

  res.end();
});

// ── API: free multiplayer games ───────────────────────────────────────────────

app.get('/api/free-games', async (req, res) => {
  try {
    const games = await getFreeMultiplayerGames();
    res.json({ games });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch free games.' });
  }
});

// ── Party page route ──────────────────────────────────────────────────────────

app.get('/party/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'party.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LanOps Steam Game Finder running at http://localhost:${PORT}`);
    if (!STEAM_API_KEY) {
      console.warn('WARNING: STEAM_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    // Pre-warm free games cache in the background
    getFreeMultiplayerGames().catch(err => console.error('Free games warm-up failed:', err.message));
  });
}

module.exports = { app, isMultiplayer, Semaphore, normaliseSteamInput };
