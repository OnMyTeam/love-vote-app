const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_PATH = path.join(DATA_DIR, 'votes.json');

function parseEnvValue(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'mi'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function parseEnvArray(source, key) {
  const value = parseEnvValue(source, key);
  const arrayValue = value.match(/^\[([^\]]*)\]$/)?.[1];
  if (arrayValue === undefined) return [];
  return arrayValue
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseEnvPassword(source, key) {
  return parseEnvValue(source, key);
}

function loadConfig() {
  const source = fs.readFileSync(ENV_PATH, 'utf8');
  const boy = parseEnvArray(source, 'boy');
  const girl = parseEnvArray(source, 'girl');
  const adminPassword = parseEnvPassword(source, 'admin_password');
  if (!boy.length && !girl.length) {
    throw new Error('.env에 boy 또는 girl 참여자가 없습니다.');
  }
  if (!adminPassword) {
    throw new Error('.env에 admin_password가 없습니다.');
  }
  return { boy, girl, adminPassword };
}

function passwordMatches(config, password) {
  return config.adminPassword === password;
}

function writeCandidateConfig(config, group) {
  const source = fs.readFileSync(ENV_PATH, 'utf8');
  const linePattern = new RegExp(`^(\\s*${group}\\s*=\\s*)\\[[^\\]]*\\]`, 'mi');
  if (!linePattern.test(source)) throw new Error(`${group} 설정을 .env에서 찾을 수 없습니다.`);
  const updated = source.replace(linePattern, (match, prefix) => `${prefix}${JSON.stringify(config[group])}`);
  const tempPath = `${ENV_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, updated, 'utf8');
  fs.renameSync(tempPath, ENV_PATH);
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ votes: [], settings: { resultLimit: 3 } }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const resultLimit = Number(parsed.settings?.resultLimit);
    return {
      votes: Array.isArray(parsed.votes) ? parsed.votes : [],
      settings: { resultLimit: Number.isInteger(resultLimit) && resultLimit > 0 ? resultLimit : 3 },
    };
  } catch {
    return { votes: [], settings: { resultLimit: 3 } };
  }
}

function writeStore(store) {
  ensureStore();
  const tempPath = `${DATA_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tempPath, DATA_PATH);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getRound(date = new Date()) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  return `${year}-${month}-${day} ${hour}:00`;
}

function formatRound(roundKey) {
  const [date, hourText] = roundKey.split(' ');
  const [year, month, day] = date.split('-');
  const hour = Number(hourText.slice(0, 2));
  return {
    key: roundKey,
    dateLabel: `${year}.${month}.${day}`,
    timeLabel: `${pad(hour)}:00 — ${pad((hour + 1) % 24)}:00`,
  };
}

function getPeople(config) {
  return [
    ...config.boy.map((name) => ({ name, group: 'boy' })),
    ...config.girl.map((name) => ({ name, group: 'girl' })),
  ];
}

function getParticipantGroup(config, voterName) {
  if (config.boy.includes(voterName)) return 'boy';
  if (config.girl.includes(voterName)) return 'girl';
  return null;
}

function getResultLimit(store, candidateCount) {
  return Math.min(Math.max(store.settings?.resultLimit || 3, 1), candidateCount);
}

function buildRanking(names, counts, limit) {
  return names
    .map((name) => ({ name, count: counts[name] || 0 }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ko'))
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function buildStatus(voterName, voterRole) {
  const config = loadConfig();
  const publicConfig = { boy: config.boy, girl: config.girl };
  const store = readStore();
  const resultLimit = getResultLimit(store, publicConfig.boy.length + publicConfig.girl.length);
  const currentRound = getRound();
  const eligible = getPeople(config);
  const roundVotes = store.votes.filter((vote) => vote.round === currentRound);
  const completedRounds = [...new Set(store.votes.map((vote) => vote.round))]
    .sort()
    .reverse();

  const history = completedRounds.map((round) => {
    const votes = store.votes.filter((vote) => vote.round === round);
    const counts = {};
    votes.forEach((vote) => { counts[vote.candidate] = (counts[vote.candidate] || 0) + 1; });
    const boyRanking = buildRanking(publicConfig.boy, counts, resultLimit);
    const girlRanking = buildRanking(publicConfig.girl, counts, resultLimit);
    const combinedRanking = [...boyRanking, ...girlRanking].sort((left, right) => right.count - left.count);
    const winnerCount = combinedRanking[0]?.count || 0;
    return {
      ...formatRound(round),
      total: votes.length,
      complete: votes.length >= eligible.length,
      winner: combinedRanking.filter(({ count }) => count === winnerCount).map(({ name }) => name),
      ranking: combinedRanking.slice(0, resultLimit),
      boyRanking,
      girlRanking,
      candidates: [...publicConfig.boy, ...publicConfig.girl].map((name) => ({ name, count: counts[name] || 0 })),
    };
  }).filter((round) => round.complete);

  const currentCounts = {};
  roundVotes.forEach((vote) => { currentCounts[vote.candidate] = (currentCounts[vote.candidate] || 0) + 1; });
  return {
    config: publicConfig,
    voter: voterName ? {
      name: voterName,
      role: voterRole || null,
      group: getParticipantGroup(config, voterName),
    } : null,
    currentRound: formatRound(currentRound),
    current: {
      total: roundVotes.length,
      eligible: eligible.length,
      complete: roundVotes.length >= eligible.length,
      hasVoted: Boolean(voterName && roundVotes.some((vote) => vote.voter === voterName)),
      candidates: [...publicConfig.boy, ...publicConfig.girl].map((name) => ({ name, count: currentCounts[name] || 0 })),
    },
    admin: voterRole === 'admin' ? {
      activeCount: activeParticipants.size,
      activeParticipants: [...activeParticipants.keys()].map((name) => ({ name, group: getParticipantGroup(config, name) })),
      resultLimit,
    } : null,
    history,
  };
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();
const activeParticipants = new Map();

function clearSession(token) {
  const session = sessions.get(token);
  if (!session) return;
  if (session.role === 'participant' && activeParticipants.get(session.name) === token) {
    activeParticipants.delete(session.name);
  }
  sessions.delete(token);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) clearSession(token);
  }
}

function getSession(token) {
  pruneSessions();
  const session = sessions.get(token);
  if (session) session.lastSeen = Date.now();
  return session;
}

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/config', (req, res) => {
  try {
    res.json(buildStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session', (req, res) => {
  pruneSessions();
  const role = String(req.body?.role || '');
  const name = String(req.body?.name || '').trim();
  let valid = false;
  let normalizedName = name;
  const config = loadConfig();

  if (role === 'participant') {
    valid = [...config.boy, ...config.girl].includes(name);
  } else if (role === 'admin') {
    valid = passwordMatches(config, String(req.body?.password || ''));
    normalizedName = '관리자';
  } else if (role === 'guest') {
    valid = true;
    normalizedName = 'Guest';
  }

  if (!valid) {
    const error = role === 'admin' ? '관리자 비밀번호가 올바르지 않습니다.' : '.env에 등록된 참여자 이름을 입력해 주세요.';
    return res.status(401).json({ error });
  }
  if (role === 'participant') {
    const activeToken = activeParticipants.get(normalizedName);
    if (activeToken && sessions.has(activeToken)) {
      return res.status(409).json({ error: `${normalizedName}님은 이미 참여 중입니다. 다른 참여자 이름을 입력해 주세요.` });
    }
    if (activeToken) activeParticipants.delete(normalizedName);
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role, name: normalizedName, createdAt: Date.now(), lastSeen: Date.now() });
  if (role === 'participant') activeParticipants.set(normalizedName, token);
  return res.json({ token, role, name: normalizedName, canVote: role === 'participant', status: buildStatus(normalizedName, role) });
});

app.get('/api/status', (req, res) => {
  const token = req.get('x-session-token');
  const session = getSession(token);
  if (token && !session) return res.status(401).json({ error: '참여 세션이 만료되었습니다. 다시 입장해 주세요.' });
  res.json(buildStatus(session?.name, session?.role));
});

app.post('/api/votes', (req, res) => {
  const session = getSession(req.get('x-session-token'));
  if (!session) return res.status(401).json({ error: '먼저 참여자 유형을 선택해 주세요.' });
  if (session.role !== 'participant') return res.status(403).json({ error: '관리자와 Guest는 투표할 수 없습니다.' });

  const config = loadConfig();
  const participantGroup = getParticipantGroup(config, session.name);
  const candidates = session.role === 'participant'
    ? participantGroup === 'boy' ? config.girl : config.boy
    : [];
  const candidate = String(req.body?.candidate || '').trim();
  if (!candidates.includes(candidate)) return res.status(400).json({ error: '유효하지 않은 투표 대상입니다.' });

  const store = readStore();
  const round = getRound();
  if (store.votes.some((vote) => vote.round === round && vote.voter === session.name)) {
    return res.status(409).json({ error: '이번 시간에는 이미 투표했습니다.' });
  }
  store.votes.push({ round, voter: session.name, candidate, createdAt: new Date().toISOString() });
  writeStore(store);
  return res.json({ message: '투표가 저장되었습니다.', status: buildStatus(session.name, session.role) });
});

app.post('/api/logout', (req, res) => {
  const token = req.get('x-session-token') || String(req.body?.token || '');
  clearSession(token);
  return res.status(204).end();
});

function getAdminSession(req, res) {
  const session = getSession(req.get('x-session-token'));
  if (!session) {
    res.status(401).json({ error: '관리자 세션이 없습니다. 다시 로그인해 주세요.' });
    return null;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: '관리자만 사용할 수 있는 기능입니다.' });
    return null;
  }
  return session;
}

app.post('/api/admin/release-participants', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session) return;
  let released = 0;
  for (const [token, participant] of sessions) {
    if (participant.role === 'participant') {
      clearSession(token);
      released += 1;
    }
  }
  return res.json({ message: `${released}명의 참여상태를 해제했습니다.`, released, status: buildStatus(session.name, session.role) });
});

app.post('/api/admin/kick-participant', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session) return;
  const name = String(req.body?.name || '').trim();
  const token = activeParticipants.get(name);
  if (!token || !sessions.has(token)) {
    activeParticipants.delete(name);
    return res.status(404).json({ error: `${name || '해당 참여자'}는 현재 참여 중이 아닙니다.` });
  }
  clearSession(token);
  return res.json({ message: `${name}님의 참여 세션을 종료했습니다.`, status: buildStatus(session.name, session.role) });
});

app.post('/api/admin/reset-round', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session) return;
  const round = String(req.body?.round || '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(round)) {
    return res.status(400).json({ error: '초기화할 시간대가 올바르지 않습니다.' });
  }
  const store = readStore();
  const before = store.votes.length;
  store.votes = store.votes.filter((vote) => vote.round !== round);
  writeStore(store);
  return res.json({ message: `${formatRound(round).timeLabel} 투표를 초기화했습니다.`, removed: before - store.votes.length, status: buildStatus(session.name, session.role) });
});

app.post('/api/admin/result-limit', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session) return;
  const config = loadConfig();
  const candidateCount = config.boy.length + config.girl.length;
  const resultLimit = Number(req.body?.resultLimit);
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > candidateCount) {
    return res.status(400).json({ error: `표시 인원은 1명부터 ${candidateCount}명 사이로 입력해 주세요.` });
  }
  const store = readStore();
  store.settings.resultLimit = resultLimit;
  writeStore(store);
  return res.json({ message: `투표 종료 후 상위 ${resultLimit}명까지 표시합니다.`, status: buildStatus(session.name, session.role) });
});

app.post('/api/admin/candidates', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session) return;
  const group = String(req.body?.group || '').trim();
  const action = String(req.body?.action || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!['boy', 'girl'].includes(group) || !['add', 'delete'].includes(action)) {
    return res.status(400).json({ error: '후보 성별 또는 작업이 올바르지 않습니다.' });
  }
  if (!name || name.length > 30 || [...name].some((character) => ",[]{}<>\"'\\\r\n".includes(character))) {
    return res.status(400).json({ error: '후보자 이름은 1~30자의 일반 문자로 입력해 주세요.' });
  }

  const config = loadConfig();
  if (action === 'add') {
    if ([...config.boy, ...config.girl].includes(name)) {
      return res.status(409).json({ error: '이미 등록된 후보자 이름입니다.' });
    }
    config[group].push(name);
  } else {
    const index = config[group].indexOf(name);
    if (index === -1) return res.status(404).json({ error: '해당 후보자를 찾을 수 없습니다.' });
    config[group].splice(index, 1);
    const activeToken = activeParticipants.get(name);
    if (activeToken) clearSession(activeToken);
  }
  if (!config.boy.length && !config.girl.length) {
    return res.status(400).json({ error: '남자 또는 여자 후보가 최소 1명은 필요합니다.' });
  }
  writeCandidateConfig(config, group);
  const actionLabel = action === 'add' ? '추가' : '삭제';
  return res.json({ message: `${group === 'boy' ? '남자' : '여자'} 후보 ${name}님을 ${actionLabel}했습니다.`, status: buildStatus(session.name, session.role) });
});

app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.listen(PORT, () => {
  ensureStore();
  console.log(`Love Vote is running at http://localhost:${PORT}`);
});
