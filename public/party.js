/* ── State ──────────────────────────────────────────────────────────────────── */
const partyId = window.location.pathname.split('/party/')[1]?.replace(/\/$/, '');
let currentUser = null;
let party = null;
let allGames = [];
let currentSort = 'playtime';
let filterText = '';
let searchInProgress = false;
let memberCountAtLastSearch = 0;

/* ── DOM refs ────────────────────────────────────────────────────────────────── */
const partyNotFound   = document.getElementById('partyNotFound');
const partyHero       = document.getElementById('partyHero');
const partyActions    = document.getElementById('partyActions');
const partyLinkInput  = document.getElementById('partyLinkInput');
const copyLinkBtn     = document.getElementById('copyLinkBtn');
const membersSection  = document.getElementById('membersSection');
const memberList      = document.getElementById('memberList');
const memberCount     = document.getElementById('memberCount');
const refreshBtn      = document.getElementById('refreshBtn');
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

/* ── Party link copy ─────────────────────────────────────────────────────────── */
copyLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(partyLinkInput.value);
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
  } catch {
    partyLinkInput.select();
  }
});

/* ── Sort / filter ───────────────────────────────────────────────────────────── */
sortSelect.addEventListener('change', () => { currentSort = sortSelect.value; renderGames(); });
filterInput.addEventListener('input', () => { filterText = filterInput.value.toLowerCase(); renderGames(); });

/* ── Auth ────────────────────────────────────────────────────────────────────── */
async function initAuth() {
  const res = await fetch('/api/me').catch(() => null);
  if (!res?.ok) return;
  const { user } = await res.json();
  currentUser = user;

  if (user) {
    if (user.avatar) userAvatar.src = user.avatar;
    userNameEl.textContent = user.name;
    userChip.classList.remove('hidden');
    loginBtn.classList.add('hidden');
  } else {
    // Set returnTo so after login they come back here
    loginBtn.href = `/auth/steam?returnTo=/party/${partyId}`;
    loginBtn.classList.remove('hidden');
  }
}

/* ── Load party ──────────────────────────────────────────────────────────────── */
async function loadParty() {
  const res = await fetch(`/api/party/${partyId}`).catch(() => null);
  if (!res?.ok) {
    partyNotFound.classList.remove('hidden');
    return false;
  }
  party = await res.json();
  return true;
}

/* ── Render party UI ─────────────────────────────────────────────────────────── */
function renderParty() {
  const url = `${window.location.origin}/party/${partyId}`;
  partyLinkInput.value = url;

  partyHero.classList.remove('hidden');
  membersSection.classList.remove('hidden');

  renderMembers();
  renderPartyActions();
}

function renderMembers() {
  memberCount.textContent = party.members.length;
  memberList.innerHTML = '';
  for (const m of party.members) {
    memberList.appendChild(makeAccountChip(m));
  }
}

function renderPartyActions() {
  partyActions.innerHTML = '';

  const isMember = currentUser && party.members.some(m => m.steamid === currentUser.steamid);
  const isOwner = currentUser && party.ownerId === currentUser.steamid;

  if (!currentUser) {
    // Show "Sign in to join" button
    const btn = document.createElement('a');
    btn.href = `/auth/steam?returnTo=/party/${partyId}`;
    btn.className = 'btn-steam';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.38l3.05-6.3a3.5 3.5 0 01-.76-6.83L7.55 6.1A6.02 6.02 0 0118 12a6 6 0 01-6 6 5.96 5.96 0 01-2.07-.37l-2.72 5.63C8.45 23.7 10.2 24 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0zm-1.5 13.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg> Sign in to join`;
    partyActions.appendChild(btn);
  } else if (!isMember) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'Join Party';
    btn.addEventListener('click', joinParty);
    partyActions.appendChild(btn);
  } else {
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn-secondary btn-danger';
    leaveBtn.textContent = 'Leave Party';
    leaveBtn.addEventListener('click', leaveParty);
    partyActions.appendChild(leaveBtn);

    if (isOwner) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-secondary btn-danger';
      deleteBtn.textContent = 'Delete Party';
      deleteBtn.addEventListener('click', deleteParty);
      partyActions.appendChild(deleteBtn);
    }
  }
}

/* ── Join / Leave / Delete ───────────────────────────────────────────────────── */
async function joinParty() {
  const res = await fetch(`/api/party/${partyId}/join`, { method: 'POST' }).catch(() => null);
  if (!res?.ok) return;
  party = await res.json();
  renderMembers();
  renderPartyActions();
  maybeStartSearch();
}

async function leaveParty() {
  await fetch(`/api/party/${partyId}/leave`, { method: 'POST' }).catch(() => null);
  window.location.href = '/';
}

async function deleteParty() {
  if (!confirm('Delete this party? All members will lose the link.')) return;
  await fetch(`/api/party/${partyId}`, { method: 'DELETE' }).catch(() => null);
  window.location.href = '/';
}

/* ── Party events SSE ────────────────────────────────────────────────────────── */
function connectPartyEvents() {
  const es = new EventSource(`/api/party/${partyId}/events`);

  es.addEventListener('state', e => {
    party = JSON.parse(e.data);
    renderMembers();
    renderPartyActions();
  });

  es.addEventListener('member-joined', e => {
    const { member } = JSON.parse(e.data);
    if (!party.members.find(m => m.steamid === member.steamid)) {
      party.members.push(member);
    }
    renderMembers();
    renderPartyActions();
    // Show refresh button if we already have results
    if (allGames.length > 0 || resultsSection.classList.contains('hidden') === false) {
      refreshBtn.classList.remove('hidden');
    } else {
      maybeStartSearch();
    }
  });

  es.addEventListener('member-left', e => {
    const { steamid } = JSON.parse(e.data);
    party.members = party.members.filter(m => m.steamid !== steamid);
    renderMembers();
    renderPartyActions();
    if (allGames.length > 0) refreshBtn.classList.remove('hidden');
  });

  es.addEventListener('party-deleted', () => {
    alert('This party has been deleted by the owner.');
    window.location.href = '/';
  });

  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do
  };
}

/* ── Game search ─────────────────────────────────────────────────────────────── */
refreshBtn.addEventListener('click', startSearch);

function maybeStartSearch() {
  if (party.members.length >= 2 && !searchInProgress) startSearch();
}

function startSearch() {
  if (searchInProgress) return;
  searchInProgress = true;
  memberCountAtLastSearch = party.members.length;
  refreshBtn.classList.add('hidden');
  resetSearchUI();
  statusSection.classList.remove('hidden');
  setProgress(5, 'Starting…');

  fetch(`/api/party/${partyId}/games`)
    .then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Server error: ${res.status}`);
      }
      if (!res.body) throw new Error('No response body');
      return readSseStream(res, ({ event, data }) => handleGameEvent(event, data));
    })
    .then(() => { searchInProgress = false; })
    .catch(err => {
      showError(err.message);
      searchInProgress = false;
    });
}

function handleGameEvent(event, data) {
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
    div.innerHTML = `<strong>Could not resolve:</strong> ${resolutionErrors.map(e => escHtml(e.error)).join('; ')}`;
    privateWarnings.appendChild(div);
  }

  if (privateAccounts?.length) appendPrivateAccounts(privateAccounts);

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

function renderResults({ commonGames, message }) {
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
  if (filterText) games = games.filter(g => g.name.toLowerCase().includes(filterText));
  if (currentSort === 'name') {
    games.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'cumulative') {
    games.sort((a, b) => b.totalMinutes - a.totalMinutes);
  } else {
    games.sort((a, b) => b.avgHours - a.avgHours);
  }

  gameCountEl.textContent = `${games.length} game${games.length !== 1 ? 's' : ''}`;

  if (!games.length) {
    gameGrid.innerHTML = filterText
      ? `<p class="no-results">No games match "${escHtml(filterText)}"</p>`
      : `<p class="no-results">No common multiplayer games found.</p>`;
    return;
  }

  gameGrid.innerHTML = '';
  for (const game of games) gameGrid.appendChild(makeGameCard(game));
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

function resetSearchUI() {
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

/* ── Init ────────────────────────────────────────────────────────────────────── */
async function init() {
  await initAuth();
  const ok = await loadParty();
  if (!ok) return;

  renderParty();
  connectPartyEvents();
  maybeStartSearch();
}

init();
