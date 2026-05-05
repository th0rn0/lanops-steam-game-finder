/* ── State ──────────────────────────────────────────────────────────────────── */
let allGames = [];
let currentSort = 'playtime';
let filterText = '';
let currentUser = null;
let allFriends = [];
let friendsLoaded = false;

/* ── DOM refs ────────────────────────────────────────────────────────────────── */
const steamInput      = document.getElementById('steamInput');
const findBtn         = document.getElementById('findBtn');
const clearBtn        = document.getElementById('clearBtn');
const friendPickerBtn = document.getElementById('friendPickerBtn');
const statusSection   = document.getElementById('status');
const progressBar     = document.getElementById('progressBar');
const statusMsg       = document.getElementById('statusMsg');
const accountsSection = document.getElementById('accountsSection');
const privateWarnings = document.getElementById('privateWarnings');
const publicAccountsEl= document.getElementById('publicAccounts');
const resultsSection  = document.getElementById('resultsSection');
const gameGrid        = document.getElementById('gameGrid');
const gameCountEl     = document.getElementById('gameCount');
const sortSelect      = document.getElementById('sortSelect');
const filterInput     = document.getElementById('filterInput');

const loginBtn        = document.getElementById('loginBtn');
const userChip        = document.getElementById('userChip');
const userAvatar      = document.getElementById('userAvatar');
const userNameEl      = document.getElementById('userName');

const friendModal     = document.getElementById('friendModal');
const closeFriendModal= document.getElementById('closeFriendModal');
const selfRow         = document.getElementById('selfRow');
const selfAvatarEl    = document.getElementById('selfAvatar');
const selfNameEl      = document.getElementById('selfName');
const includeSelf     = document.getElementById('includeSelf');
const friendSearch    = document.getElementById('friendSearch');
const friendList      = document.getElementById('friendList');
const selectedCount   = document.getElementById('selectedCount');
const useSelectedBtn  = document.getElementById('useSelectedBtn');

/* ── Auth ────────────────────────────────────────────────────────────────────── */
async function initAuth() {
  const res = await fetch('/api/me').catch(() => null);
  if (!res?.ok) return;
  const { user } = await res.json();
  currentUser = user;

  if (user) {
    if (user.avatar) { userAvatar.src = user.avatar; }
    userNameEl.textContent = user.name;
    userChip.classList.remove('hidden');
    loginBtn.classList.add('hidden');
    friendPickerBtn.classList.remove('hidden');
    selfAvatarEl.src = user.avatar || '';
    selfNameEl.textContent = user.name;
  } else {
    loginBtn.classList.remove('hidden');
  }
}

/* ── Friend picker ────────────────────────────────────────────────────────────── */
friendPickerBtn.addEventListener('click', openFriendPicker);
closeFriendModal.addEventListener('click', closePicker);
friendModal.addEventListener('click', e => { if (e.target === friendModal) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

friendSearch.addEventListener('input', renderFriendList);
includeSelf.addEventListener('change', updateSelectedCount);
useSelectedBtn.addEventListener('click', applySelection);

async function openFriendPicker() {
  friendModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  updateSelectedCount();

  if (!friendsLoaded) {
    friendList.innerHTML = '<p class="friend-list-msg">Loading friends…</p>';
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) throw new Error('Failed to load friends');
      const { friends } = await res.json();
      allFriends = friends;
      friendsLoaded = true;
    } catch {
      friendList.innerHTML = '<p class="friend-list-msg error">Could not load friends list.</p>';
      return;
    }
  }

  renderFriendList();
}

function closePicker() {
  friendModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function renderFriendList() {
  const q = friendSearch.value.toLowerCase();
  const filtered = allFriends.filter(f => f.name.toLowerCase().includes(q));

  if (!filtered.length) {
    friendList.innerHTML = `<p class="friend-list-msg">${q ? 'No friends match.' : 'No friends found.'}</p>`;
    return;
  }

  friendList.innerHTML = '';
  for (const friend of filtered) {
    const label = document.createElement('label');
    label.className = 'friend-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = friend.steamid;
    cb.dataset.name = friend.name;
    cb.addEventListener('change', updateSelectedCount);

    const avatar = document.createElement('img');
    avatar.src = friend.avatar || '';
    avatar.alt = friend.name;
    avatar.className = 'friend-avatar';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'friend-name';
    nameSpan.textContent = friend.name;

    if (friend.online) {
      const dot = document.createElement('span');
      dot.className = 'online-dot';
      label.appendChild(cb);
      label.appendChild(avatar);
      label.appendChild(nameSpan);
      label.appendChild(dot);
    } else {
      label.appendChild(cb);
      label.appendChild(avatar);
      label.appendChild(nameSpan);
    }

    friendList.appendChild(label);
  }

  updateSelectedCount();
}

function updateSelectedCount() {
  const checked = friendList.querySelectorAll('input[type=checkbox]:checked').length;
  const selfChecked = includeSelf.checked ? 1 : 0;
  const total = checked + selfChecked;
  selectedCount.textContent = `${total} selected`;
  useSelectedBtn.disabled = total < 2;
}

function applySelection() {
  const lines = [];

  if (includeSelf.checked && currentUser) {
    lines.push(currentUser.steamid);
  }

  for (const cb of friendList.querySelectorAll('input[type=checkbox]:checked')) {
    lines.push(cb.value);
  }

  steamInput.value = lines.join('\n');
  closePicker();
}

/* ── Event listeners ──────────────────────────────────────────────────────────── */
findBtn.addEventListener('click', startSearch);
clearBtn.addEventListener('click', clearAll);
sortSelect.addEventListener('change', () => { currentSort = sortSelect.value; renderGames(); });
filterInput.addEventListener('input', () => { filterText = filterInput.value.toLowerCase(); renderGames(); });
steamInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startSearch();
});

/* ── Main search flow ─────────────────────────────────────────────────────────── */
function startSearch() {
  const raw = steamInput.value.trim();
  if (!raw) return;

  const inputs = raw.split('\n').map(s => s.trim()).filter(Boolean);
  if (inputs.length < 2) {
    showError('Please enter at least 2 Steam IDs (one per line).');
    return;
  }

  resetUI();
  findBtn.disabled = true;
  statusSection.classList.remove('hidden');
  setProgress(5, 'Starting…');

  fetch('/api/find-games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steamIds: inputs }),
  }).then(async res => {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Server error: ${res.status}`);
    }
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) { findBtn.disabled = false; return; }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) handleSSE(part);
        return pump();
      });
    }
    return pump();
  }).catch(err => {
    showError(err.message);
    findBtn.disabled = false;
  });
}

function handleSSE(raw) {
  const lines = raw.trim().split('\n');
  let event = 'message';
  let dataStr = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) dataStr = line.slice(6);
  }
  if (!dataStr) return;

  let data;
  try { data = JSON.parse(dataStr); } catch { return; }

  switch (event) {
    case 'progress':
      setProgress((data.step / data.total) * 90, data.message);
      break;

    case 'accounts':
      renderAccounts(data);
      break;

    case 'accounts-update':
      appendPrivateAccounts(data.newPrivateAccounts || []);
      break;

    case 'checking':
      setProgress(
        90 + (data.checked / data.total) * 9,
        `Checking multiplayer status… ${data.checked} / ${data.total}`
      );
      break;

    case 'done':
      setProgress(100, 'Done!');
      allGames = data.commonGames || [];
      renderResults(data);
      setTimeout(() => statusSection.classList.add('hidden'), 800);
      break;

    case 'error':
      showError(data.message);
      findBtn.disabled = false;
      break;
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────────── */
function renderAccounts({ privateAccounts, publicAccounts, resolutionErrors }) {
  accountsSection.classList.remove('hidden');
  privateWarnings.innerHTML = '';
  publicAccountsEl.innerHTML = '';

  if (resolutionErrors?.length) {
    const div = document.createElement('div');
    div.className = 'error-banner';
    div.innerHTML = `<strong>Could not resolve:</strong> ${resolutionErrors.map(e => e.error).join('; ')}`;
    privateWarnings.appendChild(div);
  }

  if (privateAccounts?.length) {
    appendPrivateAccounts(privateAccounts);
  }

  for (const acc of (publicAccounts || [])) {
    publicAccountsEl.appendChild(makeAccountChip(acc));
  }
}

function appendPrivateAccounts(accounts) {
  if (!accounts.length) return;
  let banner = privateWarnings.querySelector('.warning-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'warning-banner';
    banner.innerHTML = `
      <div class="warn-title">&#9888; Private or inaccessible accounts (excluded from results)</div>
      <ul class="private-list"></ul>
    `;
    privateWarnings.prepend(banner);
  }
  const list = banner.querySelector('.private-list');
  for (const acc of accounts) {
    const li = document.createElement('li');
    li.textContent = acc.name || acc.steamid;
    list.appendChild(li);
  }
}

function makeAccountChip(acc) {
  const chip = document.createElement('div');
  chip.className = 'account-chip';
  const avatarEl = acc.avatar
    ? `<img src="${acc.avatar}" alt="${escHtml(acc.name)}" />`
    : `<div class="avatar-placeholder">${(acc.name || '?')[0].toUpperCase()}</div>`;
  chip.innerHTML = `${avatarEl}<span>${escHtml(acc.name || acc.steamid)}</span>`;
  return chip;
}

function renderResults({ commonGames, totalCommon, multiplayerCount, message }) {
  resultsSection.classList.remove('hidden');

  if (message && !commonGames?.length) {
    gameGrid.innerHTML = `<p class="no-results">${escHtml(message)}</p>`;
    gameCountEl.textContent = '0 games';
    return;
  }

  renderGames();
}

function renderGames() {
  let games = [...allGames];

  if (filterText) {
    games = games.filter(g => g.name.toLowerCase().includes(filterText));
  }

  if (currentSort === 'name') {
    games.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    games.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }

  gameCountEl.textContent = `${games.length} game${games.length !== 1 ? 's' : ''}`;

  if (!games.length) {
    gameGrid.innerHTML = filterText
      ? `<p class="no-results">No games match "${escHtml(filterText)}"</p>`
      : `<p class="no-results">No common multiplayer games found.</p>`;
    return;
  }

  gameGrid.innerHTML = '';
  for (const game of games) {
    gameGrid.appendChild(makeGameCard(game));
  }
}

function makeGameCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';

  const cats = (game.categories || [])
    .map(c => `<span class="cat-tag">${escHtml(c)}</span>`)
    .join('');

  const playtimeRows = (game.playtimeInfo || []).map(p => {
    const avatarEl = p.avatar
      ? `<img src="${p.avatar}" alt="${escHtml(p.name)}" />`
      : `<div class="avatar-sm">${(p.name || '?')[0].toUpperCase()}</div>`;
    const hoursClass = p.hours === 0 ? 'zero' : '';
    const hoursLabel = p.hours === 0 ? 'Never played' : `${p.hours}h`;
    return `<div class="playtime-row">${avatarEl}<span>${escHtml(p.name)}</span><span class="playtime-hours ${hoursClass}">${hoursLabel}</span></div>`;
  }).join('');

  card.innerHTML = `
    <div class="game-img-wrap">
      <img class="loading" src="${escHtml(game.headerImage)}" alt="${escHtml(game.name)}" loading="lazy" />
    </div>
    <div class="game-body">
      <div class="game-name">${escHtml(game.name)}</div>
      <div class="game-categories">${cats}</div>
      <div class="playtime-list">${playtimeRows}</div>
    </div>
    <a class="store-link" href="${escHtml(game.storeUrl)}" target="_blank" rel="noopener">View on Steam Store &#8599;</a>
  `;

  const img = card.querySelector('img');
  img.addEventListener('load', () => img.classList.remove('loading'));
  img.addEventListener('error', () => { img.style.display = 'none'; });

  return card;
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function setProgress(pct, msg) {
  progressBar.style.width = `${Math.min(100, pct)}%`;
  if (msg) statusMsg.textContent = msg;
}

function showError(msg) {
  statusSection.classList.remove('hidden');
  progressBar.style.width = '100%';
  progressBar.style.background = 'var(--danger)';
  statusMsg.textContent = `Error: ${msg}`;
  statusMsg.style.color = 'var(--danger)';
}

function resetUI() {
  allGames = [];
  filterText = '';
  filterInput.value = '';
  progressBar.style.width = '0%';
  progressBar.style.background = '';
  statusMsg.style.color = '';
  accountsSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  privateWarnings.innerHTML = '';
  publicAccountsEl.innerHTML = '';
  gameGrid.innerHTML = '';
}

function clearAll() {
  steamInput.value = '';
  resetUI();
  statusSection.classList.add('hidden');
  findBtn.disabled = false;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Init ────────────────────────────────────────────────────────────────────── */
initAuth();
