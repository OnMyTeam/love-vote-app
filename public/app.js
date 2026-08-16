const state = { role: null, token: null, name: null, status: null, selected: null };
const $ = (selector) => document.querySelector(selector);
const landingView = $('#landing-view');
const nameView = $('#name-view');
const voteView = $('#vote-view');
const SESSION_STORAGE_KEY = 'love-vote-session';

function show(view) {
  [landingView, nameView, voteView].forEach((item) => item.classList.add('hidden'));
  view.classList.remove('hidden');
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove('show'), 2800);
}

function sessionHeaders() {
  return state.token ? { 'x-session-token': state.token } : {};
}

function saveSession() {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: state.token, role: state.role, name: state.name }));
}

function clearSavedSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function chooseRole(role) {
  state.role = role;
  $('#login-error').textContent = '';
  $('#name-input').value = '';
  const isAdmin = role === 'admin';
  const isGuest = role === 'guest';
  $('#login-icon').textContent = isAdmin ? '⌘' : '✦';
  $('#login-icon').style.color = isAdmin ? '#315b9c' : isGuest ? '#a74263' : 'var(--blue)';
  $('#login-eyebrow').textContent = isAdmin ? 'ADMIN ACCESS' : isGuest ? 'GUEST ACCESS' : 'PARTICIPANT ACCESS';
  $('#login-title').innerHTML = isAdmin ? '관리자 화면으로<br /><span>입장합니다</span>' : isGuest ? '결과를<br /><span>확인해 보세요</span>' : '참여자 이름을<br /><span>확인해 주세요</span>';
  $('#login-copy').textContent = isAdmin ? '관리자는 투표 현황과 결과만 확인할 수 있어요.' : isGuest ? 'Guest는 투표 없이 현재 현황만 볼 수 있어요.' : '등록된 이름만 투표할 수 있어요.';
  $('#name-label').textContent = isAdmin ? '관리자 비밀번호' : isGuest ? '표시 이름' : '이름';
  $('#name-input').type = isAdmin ? 'password' : 'text';
  $('#name-input').autocomplete = isAdmin ? 'new-password' : 'off';
  $('#name-input').placeholder = isAdmin ? '비밀번호를 입력하세요' : isGuest ? 'Guest' : '이름을 입력하세요';
  $('#name-input').closest('label')?.remove();
  show(nameView);
  if (isGuest) {
    $('#name-input').value = 'Guest';
    enter();
    return;
  }
  if (isAdmin) {
    $('#name-input').value = '';
    $('#name-input').defaultValue = '';
    $('#name-input').removeAttribute('value');
    window.setTimeout(() => { $('#name-input').value = ''; }, 0);
  }
  $('#name-input').focus();
}

function renderCandidates(config, voterGroup, readOnly = false) {
  const groups = voterGroup === 'boy' ? ['girl'] : voterGroup === 'girl' ? ['boy'] : ['boy', 'girl'];
  const sections = groups.map((group) => {
    const names = group === 'boy' ? config.boy : config.girl;
    const label = group === 'boy' ? 'BOY' : 'GIRL';
    const koreanLabel = group === 'boy' ? '남자' : '여자';
    const character = group === 'boy' ? '👦' : '👧';
    const makeList = names.map((name) => readOnly
      ? `<div class="candidate-option readonly-option"><div class="candidate-card"><span class="candidate-character ${group}-character" aria-hidden="true">${character}</span><span class="candidate-name">${name}</span></div></div>`
      : `<div class="candidate-option"><input type="radio" id="${group}-${name}" name="candidate" value="${name}" /><label for="${group}-${name}"><span class="candidate-character ${group}-character" aria-hidden="true">${character}</span><span class="candidate-name">${name}</span></label></div>`).join('');
    return `<div class="candidate-section"><div class="section-tag ${group}-tag">${label} <span>${koreanLabel}</span></div><div class="candidate-list">${makeList || '<p class="no-candidates">등록된 후보가 없습니다.</p>'}</div></div>`;
  }).join('');
  $('#candidate-sections').innerHTML = sections;
  document.querySelectorAll('input[name="candidate"]').forEach((input) => input.addEventListener('change', () => {
    state.selected = input.value;
    $('#vote-button').disabled = false;
  }));
}

function renderHistory(history) {
  $('#archive-count').textContent = `${history.length} ${history.length === 1 ? 'ROUND' : 'ROUNDS'}`;
  if (!history.length) {
    $('#history-list').innerHTML = '<div class="empty-state">첫 결과가 쌓이면<br />이곳에 기록됩니다.</div>';
    return;
  }
  const renderGenderRanking = (ranking, group, label, koreanLabel) => `<section class="gender-result ${group}-result"><div class="gender-result-label">${label} <span>${koreanLabel}</span></div><div class="ranking-list">${ranking.map((candidate) => `<div class="ranking-row"><span class="rank-badge rank-${candidate.rank}">${candidate.rank <= 3 ? '♛' : candidate.rank}</span><span class="ranking-name">${candidate.name}</span><strong>${candidate.count}표</strong></div>`).join('')}</div></section>`;
  $('#history-list').innerHTML = history.map((item) => `<article class="history-item"><div class="history-date">${item.dateLabel}</div><div class="history-time">${item.timeLabel}</div><div class="gender-result-grid">${renderGenderRanking(item.boyRanking || [], 'boy', 'BOY', '남자')}${renderGenderRanking(item.girlRanking || [], 'girl', 'GIRL', '여자')}</div><div class="history-progress">${item.total}표 완료</div></article>`).join('');
}

function renderStatus(status) {
  state.status = status;
  $('#top-round').textContent = status.currentRound.timeLabel.split(' — ')[0];
  $('#round-label').textContent = status.currentRound.timeLabel;
  const current = status.current;
  const progress = current.eligible ? Math.min(100, current.total / current.eligible * 100) : 0;
  $('#progress-bar').style.width = `${progress}%`;
  $('#progress-count').textContent = `${current.total} / ${current.eligible}`;
  $('#progress-copy').textContent = current.complete ? '이번 시간 투표가 모두 완료되었습니다' : '모든 참여자의 투표를 기다리는 중';
  $('#round-status').textContent = current.complete ? '결과 확정' : '진행 중';
  $('#round-status').classList.toggle('complete', current.complete);
  const isParticipant = state.role === 'participant';
  const isGuest = state.role === 'guest';
  const isAdmin = state.role === 'admin';
  const canVote = isParticipant && !current.hasVoted && !current.complete;
  $('#participant-vote-area').classList.toggle('hidden', !isParticipant && !isGuest);
  $('#candidate-heading-copy').textContent = isGuest ? '남자·여자 후보 목록' : '어떤 친구를 선택할까요?';
  $('#vote-button').classList.toggle('hidden', !isParticipant);
  $('#vote-note').classList.toggle('hidden', !isParticipant);
  $('#read-only-banner').classList.toggle('hidden', isParticipant);
  $('#admin-tools').classList.toggle('hidden', !isAdmin);
  if (!isParticipant) {
    $('#read-only-title').textContent = isAdmin ? '관리자 확인 모드입니다' : 'Guest 확인 모드입니다';
    $('#read-only-copy').textContent = '후보 선택과 투표는 참여자만 할 수 있어요.';
  }
  $('#vote-button').disabled = !state.selected || !canVote;
  $('#vote-note').textContent = current.hasVoted ? '이번 시간 투표를 완료했습니다. 다음 라운드를 기다려 주세요.' : '한 시간에 한 번 투표할 수 있습니다.';
  renderAdminTools(status);
  renderHistory(status.history);
}

function renderAdminTools(status) {
  if (state.role !== 'admin') return;
  $('#active-count').textContent = `참여 중 ${status.admin?.activeCount || 0}명`;
  const activeParticipants = status.admin?.activeParticipants || [];
  $('#active-participants-list').innerHTML = activeParticipants.length
    ? activeParticipants.map((participant) => `<div class="active-participant-row"><span><i class="${participant.group || 'boy'}-dot"></i>${participant.name}</span><button type="button" data-kick-participant="${participant.name}">강퇴</button></div>`).join('')
    : '<p class="no-active-participants">현재 참여 중인 사람이 없습니다.</p>';
  renderCandidateManagers(status.config);
  $('#result-limit-input').value = status.admin?.resultLimit || 3;
  const rounds = status.admin?.rounds || [status.currentRound, ...status.history];
  $('#admin-round-select').innerHTML = rounds.map((round, index) => `<option value="${round.key}">${index === 0 ? '현재 ' : ''}${round.dateLabel} · ${round.timeLabel} (${round.total}/${round.eligible})</option>`).join('');
  renderRoundParticipation(rounds[0]);
}

function renderRoundParticipation(round) {
  const element = $('#round-participation');
  if (!element) return;
  if (!round?.participants?.length) {
    element.innerHTML = '<p class="no-active-participants">참여자 정보가 없습니다.</p>';
    return;
  }
  element.innerHTML = `<div class="round-participation-summary"><strong>${round.total} / ${round.eligible}명 투표</strong><span>${round.complete ? '모두 완료' : '미투표자 있음'}</span></div>${round.participants.map((participant) => `<div class="round-participant-row"><span><i class="${participant.group}-dot"></i>${participant.name}</span><span class="${participant.voted ? 'voted' : 'not-voted'}">${participant.voted ? `투표 완료${participant.candidate ? ` · ${participant.candidate}` : ''}` : '미투표'}</span></div>`).join('')}`;
}

function renderCandidateManagers(config) {
  const render = (names, group) => names.map((name) => `<div class="managed-candidate-row"><span class="${group}-dot"></span><strong>${name}</strong><button type="button" data-delete-candidate="${name}" data-candidate-group="${group}">삭제</button></div>`).join('') || '<p class="no-managed-candidates">등록된 후보가 없습니다.</p>';
  $('#admin-boy-candidates').innerHTML = render(config.boy, 'boy');
  $('#admin-girl-candidates').innerHTML = render(config.girl, 'girl');
}

async function enter() {
  const inputName = $('#name-input').value.trim();
  if (state.role === 'participant' && !inputName) {
    $('#login-error').textContent = '이름을 입력해 주세요.';
    return;
  }
  const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: state.role, name: state.role === 'admin' ? '관리자' : inputName, password: state.role === 'admin' ? inputName : '' }) });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error || '입장할 수 없습니다.';
    $('#login-error').textContent = message;
    if (response.status === 409 || state.role === 'admin') window.alert(message);
    return;
  }
  state.token = data.token; state.name = data.name; state.selected = null;
  saveSession();
  $('#voter-name').textContent = data.name;
  if (state.role === 'participant') {
    renderCandidates(data.status.config, data.status.voter?.group, false);
  } else if (state.role === 'guest') {
    renderCandidates(data.status.config, null, true);
  } else {
    $('#candidate-sections').innerHTML = '';
  }
  renderStatus(data.status);
  show(voteView);
}

async function submitVote() {
  if (!state.selected) return;
  $('#vote-button').disabled = true;
  $('#vote-error').textContent = '';
  const response = await fetch('/api/votes', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate: state.selected }) });
  const data = await response.json();
  if (!response.ok) { $('#vote-error').textContent = data.error || '투표를 저장하지 못했습니다.'; renderStatus(state.status); return; }
  renderStatus(data.status);
  toast('마음이 안전하게 기록되었습니다 ♥');
}

function logout() {
  const token = state.token;
  if (token) fetch('/api/logout', { method: 'POST', headers: sessionHeaders(), keepalive: true }).catch(() => {});
  clearSavedSession();
  state.role = null; state.token = null; state.name = null; state.selected = null;
  show(landingView);
}

async function restoreSession() {
  const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!saved) return;
  try {
    const session = JSON.parse(saved);
    if (!session.token || !session.role) throw new Error('invalid session');
    state.token = session.token;
    state.role = session.role;
    state.name = session.name || (session.role === 'guest' ? 'Guest' : '관리자');
    const response = await fetch('/api/status', { headers: sessionHeaders() });
    if (!response.ok) throw new Error('expired session');
    const status = await response.json();
    $('#voter-name').textContent = state.name;
    if (state.role === 'participant') {
      renderCandidates(status.config, status.voter?.group, false);
    } else if (state.role === 'guest') {
      renderCandidates(status.config, null, true);
    } else {
      $('#candidate-sections').innerHTML = '';
    }
    renderStatus(status);
    show(voteView);
  } catch {
    clearSavedSession();
    state.token = null;
    state.role = null;
    state.name = null;
  }
}

async function releaseParticipants() {
  if (!window.confirm('현재 참여 중인 모든 이름의 참여상태를 해제할까요?')) return;
  const response = await fetch('/api/admin/release-participants', { method: 'POST', headers: sessionHeaders() });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '참여상태를 해제하지 못했습니다.'); return; }
  renderStatus(data.status);
  $('#admin-message').textContent = data.message;
  toast(data.message);
}

async function resetRound() {
  const round = $('#admin-round-select').value;
  if (!round) return;
  if (!window.confirm('선택한 시간대의 투표 기록을 모두 초기화할까요?')) return;
  const response = await fetch('/api/admin/reset-round', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ round }) });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '투표를 초기화하지 못했습니다.'); return; }
  renderStatus(data.status);
  $('#admin-message').textContent = data.message;
  toast(data.message);
}

async function kickParticipant(name) {
  if (!window.confirm(`${name}님의 참여 세션을 종료할까요?`)) return;
  const response = await fetch('/api/admin/kick-participant', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '참여자를 강퇴하지 못했습니다.'); return; }
  renderStatus(data.status);
  toast(data.message);
}

async function saveResultLimit() {
  const resultLimit = Number($('#result-limit-input').value);
  const response = await fetch('/api/admin/result-limit', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ resultLimit }) });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '결과 표시 인원을 저장하지 못했습니다.'); return; }
  renderStatus(data.status);
  $('#admin-message').textContent = data.message;
  toast(data.message);
}

async function addCandidate(group) {
  const input = $(`#add-${group}-candidate`);
  const name = input.value.trim();
  if (!name) return window.alert('추가할 후보자 이름을 입력해 주세요.');
  const response = await fetch('/api/admin/candidates', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', group, name }) });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '후보자를 추가하지 못했습니다.'); return; }
  input.value = '';
  renderStatus(data.status);
  toast(data.message);
}

async function deleteCandidate(group, name) {
  if (!window.confirm(`${name} 후보를 삭제할까요?`)) return;
  const response = await fetch('/api/admin/candidates', { method: 'POST', headers: { ...sessionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', group, name }) });
  const data = await response.json();
  if (!response.ok) { window.alert(data.error || '후보자를 삭제하지 못했습니다.'); return; }
  renderStatus(data.status);
  toast(data.message);
}

document.querySelectorAll('.role-card').forEach((card) => card.addEventListener('click', () => chooseRole(card.dataset.role)));
$('#name-form')?.addEventListener('submit', (event) => { event.preventDefault(); enter(); });
$('#login-form').addEventListener('submit', (event) => { event.preventDefault(); enter(); });
$('#name-back').addEventListener('click', () => show(landingView));
$('#logout-button').addEventListener('click', logout);
$('#vote-button').addEventListener('click', submitVote);
$('#release-participants').addEventListener('click', releaseParticipants);
$('#reset-round').addEventListener('click', resetRound);
$('#save-result-limit').addEventListener('click', saveResultLimit);
$('#admin-round-select').addEventListener('change', () => {
  const round = state.status?.admin?.rounds?.find((item) => item.key === $('#admin-round-select').value);
  renderRoundParticipation(round);
});
$('#active-participants-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-kick-participant]');
  if (button) kickParticipant(button.dataset.kickParticipant);
});
$('#candidate-managers').addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add-candidate]');
  if (addButton) return addCandidate(addButton.dataset.addCandidate);
  const deleteButton = event.target.closest('[data-delete-candidate]');
  if (deleteButton) deleteCandidate(deleteButton.dataset.candidateGroup, deleteButton.dataset.deleteCandidate);
});

window.setInterval(async () => {
  if (!state.token) return;
  const response = await fetch('/api/status', { headers: sessionHeaders() });
  if (response.ok) {
    renderStatus(await response.json());
  } else if (response.status === 401) {
    window.alert('참여 세션이 만료되었습니다. 다시 입장해 주세요.');
    logout();
  }
}, 30000);

fetch('/api/config').then((response) => response.json()).then((status) => {
  $('#top-round').textContent = status.currentRound.timeLabel.split(' — ')[0];
}).catch(() => {});

restoreSession();
