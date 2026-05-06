jest.mock('../../auth');

const request = require('supertest');
const nock = require('nock');
const { app } = require('../../server');

const STEAM_API = 'https://api.steampowered.com';
const STEAM_STORE = 'https://store.steampowered.com';

const PLAYER_1 = '76561197960287930';
const PLAYER_2 = '76561197960287931';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});
afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});
afterEach(() => nock.cleanAll());

// ── GET /api/me ───────────────────────────────────────────────────────────────

describe('GET /api/me', () => {
  it('returns null user when not authenticated', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });
});

// ── GET /api/friends ──────────────────────────────────────────────────────────

describe('GET /api/friends', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/friends');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Not logged in/);
  });
});

// ── POST /api/find-games — validation ─────────────────────────────────────────

describe('POST /api/find-games — validation', () => {
  it('returns 400 when steamIds is missing', async () => {
    const res = await request(app).post('/api/find-games').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 with only one Steam ID', async () => {
    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 with an empty array', async () => {
    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 with only blank strings', async () => {
    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: ['', '  '] });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/find-games — SSE stream ─────────────────────────────────────────

function parseSseEvents(body) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map(chunk => {
      const lines = chunk.split('\n');
      const eventLine = lines.find(l => l.startsWith('event: '));
      const dataLine = lines.find(l => l.startsWith('data: '));
      return {
        event: eventLine ? eventLine.slice(7) : 'message',
        data: dataLine ? JSON.parse(dataLine.slice(6)) : null,
      };
    });
}

describe('POST /api/find-games — SSE stream', () => {
  it('sends text/event-stream content-type', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'P1', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'P2', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('emits accounts then done events', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Alice', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Bob', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const eventNames = events.map(e => e.event);
    expect(eventNames).toContain('accounts');
    expect(eventNames).toContain('done');
  });

  it('separates public and private accounts correctly', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'Public', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'Private', communityvisibilitystate: 1, avatarmedium: '' },
      ]}});

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const accountsEvent = events.find(e => e.event === 'accounts');
    expect(accountsEvent.data.publicAccounts).toHaveLength(1);
    expect(accountsEvent.data.publicAccounts[0].name).toBe('Public');
    expect(accountsEvent.data.privateAccounts).toHaveLength(1);
    expect(accountsEvent.data.privateAccounts[0].name).toBe('Private');
  });

  it('emits done with no games when libraries are empty', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'P1', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'P2', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [] } });

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const done = events.find(e => e.event === 'done');
    expect(done.data.commonGames).toEqual([]);
  });

  it('finds a shared multiplayer game', async () => {
    const sharedGame = { appid: 12345, name: 'Test Game', playtime_forever: 60 };

    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'P1', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'P2', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [sharedGame] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [sharedGame] } });
    nock(STEAM_STORE).get('/api/appdetails').query(true)
      .reply(200, { '12345': {
        success: true,
        data: { name: 'Test Game', categories: [{ id: 1, description: 'Multi-player' }] },
      }});

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const done = events.find(e => e.event === 'done');
    expect(done.data.commonGames).toHaveLength(1);
    expect(done.data.commonGames[0].name).toBe('Test Game');
  });

  it('excludes a game owned by only one player', async () => {
    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'P1', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'P2', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [{ appid: 100, playtime_forever: 0 }] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [{ appid: 200, playtime_forever: 0 }] } });

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const done = events.find(e => e.event === 'done');
    expect(done.data.commonGames).toHaveLength(0);
  });

  it('excludes a shared game that is not multiplayer', async () => {
    const sharedGame = { appid: 99999, playtime_forever: 0 };

    nock(STEAM_API).get('/ISteamUser/GetPlayerSummaries/v2/').query(true)
      .reply(200, { response: { players: [
        { steamid: PLAYER_1, personaname: 'P1', communityvisibilitystate: 3, avatarmedium: '' },
        { steamid: PLAYER_2, personaname: 'P2', communityvisibilitystate: 3, avatarmedium: '' },
      ]}});
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [sharedGame] } });
    nock(STEAM_API).get('/IPlayerService/GetOwnedGames/v1/').query(true)
      .reply(200, { response: { games: [sharedGame] } });
    nock(STEAM_STORE).get('/api/appdetails').query(true)
      .reply(200, { '99999': {
        success: true,
        data: { name: 'Solo Game', categories: [{ id: 2, description: 'Single-player' }] },
      }});

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: [PLAYER_1, PLAYER_2] });

    const events = parseSseEvents(res.text);
    const done = events.find(e => e.event === 'done');
    expect(done.data.commonGames).toHaveLength(0);
  });

  it('emits an error event when not enough valid IDs can be resolved', async () => {
    nock(STEAM_API).get('/ISteamUser/ResolveVanityURL/v1/').query(true)
      .reply(200, { response: { success: 42 } })
      .get('/ISteamUser/ResolveVanityURL/v1/').query(true)
      .reply(200, { response: { success: 42 } });

    const res = await request(app)
      .post('/api/find-games')
      .send({ steamIds: ['badvanity1', 'badvanity2'] });

    const events = parseSseEvents(res.text);
    const errorEvent = events.find(e => e.event === 'error');
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.data.message).toBeTruthy();
  });
});

// ── GET /api/free-games ───────────────────────────────────────────────────────

describe('GET /api/free-games', () => {
  it('returns 200 with games array', async () => {
    nock('https://store.steampowered.com')
      .get('/search/results/')
      .query(true)
      .reply(200, {
        items: [
          { logo: 'https://cdn.akamai.steamstatic.com/steam/apps/440/header.jpg', name: 'Team Fortress 2' },
        ],
      });

    nock('https://store.steampowered.com')
      .get('/api/appdetails')
      .query(true)
      .reply(200, {
        440: {
          success: true,
          data: {
            type: 'game',
            name: 'Team Fortress 2',
            is_free: true,
            categories: [{ id: 1, description: 'Multi-player' }],
          },
        },
      });

    const res = await request(app).get('/api/free-games');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('games');
    expect(Array.isArray(res.body.games)).toBe(true);
  });

  it('returns 200 with empty array when Steam search fails', async () => {
    nock('https://store.steampowered.com')
      .get('/search/results/')
      .query(true)
      .replyWithError('connection refused');

    const res = await request(app).get('/api/free-games');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('games');
    expect(Array.isArray(res.body.games)).toBe(true);
  });
});
