const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'parties.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let parties = {};

function sweep() {
  const now = Date.now();
  for (const id of Object.keys(parties)) {
    if (now - parties[id].createdAt > TTL_MS) delete parties[id];
  }
}

function loadFromDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_PATH)) {
      parties = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      sweep();
    }
  } catch { parties = {}; }
}

function saveToDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(parties, null, 2));
  } catch {}
}

function createParty(user) {
  sweep();
  const id = crypto.randomBytes(4).toString('hex');
  parties[id] = {
    id,
    createdAt: Date.now(),
    ownerId: user.steamid,
    members: [{ steamid: user.steamid, name: user.name, avatar: user.avatar || null }],
  };
  saveToDisk();
  return parties[id];
}

function getParty(id) {
  sweep();
  return parties[id] || null;
}

function addMember(partyId, user) {
  const party = getParty(partyId);
  if (!party) return null;
  if (!party.members.find(m => m.steamid === user.steamid)) {
    party.members.push({ steamid: user.steamid, name: user.name, avatar: user.avatar || null });
    saveToDisk();
  }
  return party;
}

function removeMember(partyId, steamid) {
  const party = getParty(partyId);
  if (!party) return null;
  const before = party.members.length;
  party.members = party.members.filter(m => m.steamid !== steamid);
  if (party.members.length !== before) saveToDisk();
  return party;
}

function deleteParty(partyId) {
  if (!parties[partyId]) return false;
  delete parties[partyId];
  saveToDisk();
  return true;
}

loadFromDisk();

module.exports = { createParty, getParty, addMember, removeMember, deleteParty };
