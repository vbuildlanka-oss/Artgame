import { encodePayload, decodePayload, hideWord, revealWord, simplify } from './codec.js';
import { DrawingPad, COLORS, SIZES, ERASER, paintStatic, replay } from './canvas.js';
import { pickWord, judge, LEVELS } from './words.js';
import { confetti, sfx, buzz, isMuted, setMuted } from './fx.js';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const BASE = location.origin + location.pathname;
const LINK_TARGET = 6500; // characters; keeps links friendly for chat apps

// Builds DOM safely: strings become text nodes, never HTML. Names and notes
// arrive from links, so they must never be parsed as markup.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('dd_' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('dd_' + k, JSON.stringify(v)); return true; } catch { return false; }
  },
};

function rid(n) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => abc[x % abc.length]).join('');
}
const deviceId = store.get('dev') || (() => { const id = rid(8); store.set('dev', id); return id; })();

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const tries = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

// ---------- names + session ----------
const myName = () => (store.get('name', '') || '').trim();
const partnerName = () => (store.get('partner', '') || '').trim();
const partnerLabel = () => partnerName() || 'your partner';

function setPartner(name) {
  name = String(name || '').trim().slice(0, 16);
  if (!name) return;
  store.set('partner', name);
  refreshNames();
}
function refreshNames() {
  $$('.partner').forEach((el) => { el.textContent = partnerLabel(); });
  $('#partner-name').value = partnerName();
}

const TITLES = [[0, 'Doodle Newbies 🐣'], [8, 'Sketchy Sweethearts 💘'], [20, 'Crayon Crushes 🖍️'], [40, 'Art Soulmates 💞'], [75, 'Picasso Pair 🎨'], [120, 'Legendary Duo 👑']];
const coupleTitle = (score) => [...TITLES].reverse().find(([min]) => score >= min)[1];

const getSession = () => store.get('session', null);
function saveSession(s) { store.set('session', s); renderTeamChip(); }
const freshSession = (sid) => ({ sid, score: 0, streak: 0, best: 0, round: 0, sr: 0 });
function ensureSession() {
  let s = getSession();
  if (!s) { s = freshSession(rid(6)); saveSession(s); }
  return s;
}
// Merge the team state carried by an incoming link. Whichever side has the
// most recently scored round ("sr") wins for score/streak.
function adoptIncoming(m) {
  let s = getSession();
  if (!s || s.sid !== m.sid) s = freshSession(String(m.sid || rid(6)).slice(0, 12));
  s.round = Math.max(s.round || 0, +m.round || 0);
  if ((+m.sr || 0) > (s.sr || 0)) {
    s.score = Math.max(0, +m.score || 0);
    s.streak = Math.max(0, +m.streak || 0);
    s.best = Math.max(0, +m.best || 0);
    s.sr = +m.sr;
  }
  if (m.from) setPartner(m.from);
  saveSession(s);
  return s;
}
function renderTeamChip() {
  const s = getSession();
  const chip = $('#team-chip');
  if (!s || (!s.score && !s.round)) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.textContent = `💞 ${s.score} pts${s.streak > 1 ? ` · 🔥${s.streak}` : ''}`;
}

// ---------- gallery ----------
function addToGallery(entry) {
  let list = store.get('gallery', []).filter((e) => e.key !== entry.key);
  list.unshift(entry);
  list = list.slice(0, 40);
  while (!store.set('gallery', list) && list.length > 1) list = list.slice(0, Math.ceil(list.length / 2));
}
function updateGalleryResult(key, result) {
  const list = store.get('gallery', []);
  const e = list.find((x) => x.key === key);
  if (!e) return null;
  e.result = { ...(e.result || {}), ...result };
  store.set('gallery', list);
  return e;
}
const resultTag = (r) => (!r ? '⏳ waiting' : `${r.ok ? '✅' : '❌'} ${r.rx || ''}`.trim());

// ---------- screens ----------
let current = 'home';
let replayCtl = null;
function show(name) {
  $$('.screen').forEach((el) => el.classList.toggle('active', el.dataset.screen === name));
  document.body.dataset.screen = name;
  current = name;
  $('main').scrollTop = 0;
  $$('.name-inline').forEach((el) => el.classList.toggle('hidden', !!myName()));
  refreshNames();
}
function clearHash() { if (location.hash) history.replaceState(null, '', BASE + location.search); }
function showError(title, text) {
  $('#err-title').textContent = title;
  $('#err-text').textContent = text;
  show('error');
}
function goHome() {
  if (current === 'draw' && art.pad && art.pad.strokes.length && !confirm('Leave this doodle? It will be lost.')) return;
  stopTimer();
  replayCtl && replayCtl.cancel();
  clearHash();
  show('home');
}

async function shareLink(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'Doodle Duet', text, url }); return; } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  await copyText(url);
  toast(`Link copied! Paste it to ${partnerLabel()} 💌`);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const ta = h('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}

// =====================================================================
// ARTIST
// =====================================================================
const art = { level: 1, pick: null, rerolls: 2, pad: null, t0: 0, timer: 0, link: '', strokes: [] };

function nextWord() {
  const used = store.get('used', []);
  const avoid = art.pick ? [...used, art.pick.word] : used;
  art.pick = pickWord(art.level, avoid);
  $('#word-text').textContent = art.pick.word;
  $('#word-cat').textContent = `${LEVELS[art.level].emoji} ${art.pick.cat}`;
  $('#reroll-left').textContent = art.rerolls;
  $('#btn-reroll').disabled = art.rerolls <= 0;
  const card = $('#word-card');
  card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip');
}

function goLevel(kicker) {
  $('#level-kicker').textContent = kicker || `How tricky should ${partnerLabel()}'s puzzle be?`;
  show('level');
}

function ensurePad() {
  if (art.pad) return art.pad;
  const sw = $('#swatches');
  COLORS.forEach((c, i) => {
    if (i === ERASER) return;
    sw.append(h('button', { class: 'swatch', style: `background:${c}`, 'data-i': i, 'aria-label': `Color ${i + 1}`, onclick: () => { art.pad.color = i; art.pad.eraser = false; updateDrawUI(); sfx('pop'); } }));
  });
  const sz = $('#sizes');
  SIZES.forEach((w, i) => {
    const dot = 6 + i * 6;
    sz.append(h('button', { class: 'size', 'data-i': i, 'aria-label': ['Thin', 'Medium', 'Thick'][i], onclick: () => { art.pad.size = i; updateDrawUI(); } }, h('i', { style: `width:${dot}px;height:${dot}px` })));
  });
  art.pad = new DrawingPad({
    area: $('#pad-area'), pad: $('#pad'), base: $('#pad-base'), live: $('#pad-live'),
    onChange: updateDrawUI,
    onLimit: () => toast('Canvas is full: that is one detailed doodle! 😅'),
  });
  return art.pad;
}

function updateDrawUI() {
  const pad = art.pad;
  if (!pad) return;
  $$('.swatch').forEach((b) => b.classList.toggle('on', !pad.eraser && +b.dataset.i === pad.color));
  $$('.size').forEach((b) => {
    b.classList.toggle('on', +b.dataset.i === pad.size);
    b.querySelector('i').style.background = pad.eraser ? '#c9bdb4' : COLORS[pad.color];
  });
  $('#tool-eraser').classList.toggle('on', pad.eraser);
  $('#tool-undo').disabled = !pad.canUndo;
  $('#tool-clear').disabled = !pad.strokes.length;
  $('#btn-done').disabled = !pad.strokes.length;
  $('#pad-hint').classList.toggle('hidden', pad.strokes.length > 0 || !!pad.active);
}

function startTimer() {
  stopTimer();
  const tick = () => { $('#draw-timer').textContent = fmtTime(Math.floor((Date.now() - art.t0) / 1000)); };
  tick();
  art.timer = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(art.timer); art.timer = 0; }

function startDrawing() {
  const used = store.get('used', []);
  used.push(art.pick.word);
  store.set('used', used.slice(-80));
  show('draw');
  $('#draw-word').textContent = art.pick.word;
  $('#draw-word-btn').classList.remove('secret');
  const pad = ensurePad();
  pad.reset();
  pad.layout();
  updateDrawUI();
  art.t0 = Date.now();
  startTimer();
}

async function finishDrawing() {
  const pad = art.pad;
  if (!pad || !pad.strokes.length) return;
  const btn = $('#btn-done');
  btn.disabled = true;
  btn.textContent = 'Packing… 📦';
  stopTimer();
  try {
    const s = ensureSession();
    s.round = (s.round || 0) + 1;
    const meta = {
      k: 'd', sid: s.sid, round: s.round, from: myName(), dev: deviceId,
      w: hideWord([art.pick.word, ...art.pick.aliases].join('/'), `${s.sid}:${s.round}`),
      cat: art.pick.cat, lvl: art.level,
      t: Math.round((Date.now() - art.t0) / 1000),
      score: s.score, streak: s.streak, best: s.best, sr: s.sr,
    };
    if (s.report) meta.prev = s.report; // how the last doodle we guessed went
    let payload = '';
    for (const eps of [0.7, 1.5, 3, 5]) {
      const strokes = pad.strokes.map((st) => ({ ...st, p: simplify(st.p, eps) }));
      payload = await encodePayload(meta, strokes);
      if (payload.length <= LINK_TARGET) break;
    }
    delete s.report;
    saveSession(s);
    art.link = `${BASE}#d=${payload}`;
    art.strokes = pad.strokes.slice();
    addToGallery({
      key: `${s.sid}:${s.round}:${deviceId}`, ts: Date.now(), payload,
      word: art.pick.word, cat: art.pick.cat, lvl: art.level,
      artist: myName(), guesser: partnerName(), mine: true, result: null,
    });
    showShare(false);
  } catch (e) {
    console.error(e);
    toast('Could not pack the doodle. Try again?');
  } finally {
    btn.textContent = 'Done, send it 💌';
    updateDrawUI();
  }
}

function showShare(reopen) {
  $('#share-title').textContent = reopen ? 'This doodle is yours! 🎨' : 'Doodle packed! 📦';
  $('#share-caption').textContent = reopen ? 'Send it to your partner' : `“${art.pick ? art.pick.word : ''}”`;
  $('#share-size').textContent = `Link length: ${(art.link.length / 1000).toFixed(1)}k characters. Your drawing is inside it.`;
  show('share');
  requestAnimationFrame(() => paintStatic($('#share-preview'), art.strokes));
  sfx('pop');
}

// =====================================================================
// GUESSER
// =====================================================================
let g = null;
const WRONG = ['Nope! 🙈', 'Not quite…', 'Think simpler 😅', 'Ooh, no.', 'Your artist believes in you 💪', 'Squint harder 👀'];
const CLOSE = ['So close! 🔥 That one was free.', 'Warm… very warm! 🌶️ (free try)', 'Almost! Try a similar word ✨'];
const WIN_TITLES = ['You two are in sync! 💞', 'Mind reader! 🔮', 'Nailed it! 🎯', 'Telepathy confirmed ✨'];
const LOSE_TITLES = ['So close, yet so far 🙈', 'Art is subjective… 😅', 'That was a tough one!'];
const REACTIONS = ['😍', '🤣', '🤯', '🥹', '🎨', '🙈'];

function newProgress() {
  return { hearts: 3, revealed: [], guesses: [], closeLeft: 3, done: false, ok: false, pts: 0, bonus: 0, rx: '', note: '' };
}
function saveProgress() {
  const all = store.get('plays', {});
  all[g.key] = { ...g.prog, ts: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > 80) keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - 80).forEach((k) => delete all[k]);
  store.set('plays', all);
}

async function openDoodle(payload, data) {
  const m = data.meta;
  if (m.dev === deviceId) {
    art.link = location.href;
    art.strokes = data.strokes;
    art.pick = null;
    showShare(true);
    return;
  }
  let answers;
  try { answers = revealWord(m.w, `${m.sid}:${m.round}`).split('/').filter(Boolean); } catch { answers = []; }
  if (!answers.length || !data.strokes.length) {
    showError('This doodle is empty 😕', 'The link might have been cut off. Ask your partner to send it again.');
    return;
  }
  adoptIncoming(m);
  if (m.prev && typeof m.prev === 'object') applyReport(m.sid, m.prev);
  const key = `${m.sid}:${m.round}:${m.dev}`;
  g = { meta: m, payload, strokes: data.strokes, key, answers, word: answers[0], prog: { ...newProgress(), ...(store.get('plays', {})[key] || {}) } };

  if (g.prog.done) { showResult(); return; }
  if (g.prog.guesses.length) { startGuess(false); return; }
  showEnvelope();
}

function showEnvelope() {
  const m = g.meta;
  $('#env-title').textContent = `${m.from || 'Your partner'} sent you a doodle!`;
  $('#env-sub').textContent = `Round ${m.round} · ${LEVELS[m.lvl] ? LEVELS[m.lvl].name : 'Mystery'} · drawn in ${fmtTime(+m.t || 0)}`;
  const box = $('#env-last');
  box.replaceChildren();
  const p = m.prev;
  if (p && p.word) {
    box.append(
      h('small', { class: 'kicker' }, `Last round you drew “${p.word}”`),
      h('b', {}, p.ok ? `${m.from || 'They'} got it in ${tries(+p.tries || 1)}! +${+p.pts || 0}` : `${m.from || 'They'} couldn't guess it 🙈`),
      p.rx ? h('div', { class: 'rx' }, String(p.rx).slice(0, 4)) : null,
      p.note ? h('div', { class: 'bubble' }, String(p.note).slice(0, 80)) : null,
    );
    box.classList.remove('hidden');
  } else box.classList.add('hidden');
  $('#envelope-btn').classList.remove('opening');
  show('envelope');
}

function openEnvelope() {
  sfx('open');
  $('#envelope-btn').classList.add('opening');
  setTimeout(() => startGuess(true), 380);
}

function letterLabel(word) {
  return word.split(' ').map((w) => w.replace(/[^a-z]/gi, '').length).join(', ') + ' letters';
}

function startGuess(animate) {
  show('guess');
  renderHearts();
  renderBlanks();
  $('#guess-cat').textContent = `${g.meta.cat} · ${letterLabel(g.word)}`;
  say(animate ? 'Watch closely… 👀 (you can guess anytime)' : 'Welcome back! Keep guessing.');
  $('#guess-input').value = '';
  requestAnimationFrame(() => { fitView(); runReplay(animate); });
}

function fitView() {
  const area = $('#view-area'), box = area.firstElementChild;
  const side = Math.floor(Math.min(area.clientWidth, area.clientHeight));
  if (side > 60) box.style.width = box.style.height = side + 'px';
}
function runReplay(animate) {
  replayCtl && replayCtl.cancel();
  const cv = $('#view');
  if (!animate) { paintStatic(cv, g.strokes); return; }
  replayCtl = replay(cv, g.strokes, {
    onDone: () => { if (!g.prog.done && $('#feedback').textContent.startsWith('Watch')) say('What is it? 🤔'); },
  });
}

function say(msg) { $('#feedback').textContent = msg; }

function renderHearts(popIndex = -1) {
  const box = $('#hearts');
  box.replaceChildren();
  for (let i = 0; i < 3; i++) {
    box.append(h('span', { class: (i >= g.prog.hearts ? 'lost' : '') + (i === popIndex ? ' pop' : '') }, '❤️'));
  }
}

function renderBlanks(state = '') {
  const box = $('#blanks');
  box.replaceChildren();
  box.className = 'blanks ' + state;
  [...g.word].forEach((ch, i) => {
    if (ch === ' ') { box.append(h('span', { class: 'gap' })); return; }
    if (!/[a-z]/i.test(ch)) { box.append(h('span', { class: 'sym' }, ch)); return; }
    const on = g.prog.done || g.prog.revealed.includes(i);
    box.append(h('span', { class: 'blank' + (on ? ' on' : '') }, on ? ch.toUpperCase() : ''));
  });
}

function revealLetter() {
  const hidden = [...g.word].map((c, i) => (/[a-z]/i.test(c) && !g.prog.revealed.includes(i) ? i : -1)).filter((i) => i >= 0);
  if (hidden.length > 1) g.prog.revealed.push(pick(hidden));
}

function submitGuess(text) {
  if (!g || g.prog.done) return;
  const res = judge(text, g.answers);
  if (res === 'empty') return;
  const clean = text.trim().slice(0, 40);
  g.prog.guesses.push(clean);
  $('#guess-input').value = '';

  if (res === 'yes') return win();
  if (res === 'close' && g.prog.closeLeft > 0) {
    g.prog.closeLeft--;
    say(pick(CLOSE));
    sfx('close');
    buzz(30);
    saveProgress();
    return;
  }
  g.prog.hearts--;
  sfx('wrong');
  buzz([40, 40, 40]);
  shake($('#guess-form'));
  if (g.prog.hearts <= 0) return lose();
  revealLetter();
  renderHearts(g.prog.hearts);
  renderBlanks();
  say(`“${clean}”? ${pick(WRONG)} A letter is revealed.`);
  saveProgress();
}

function win() {
  const p = g.prog, s = ensureSession();
  p.done = true; p.ok = true;
  s.streak = (s.streak || 0) + 1;
  s.best = Math.max(s.best || 0, s.streak);
  p.bonus = s.streak >= 3 ? 1 : 0;
  p.pts = (+g.meta.lvl || 1) * p.hearts + p.bonus;
  s.score = (s.score || 0) + p.pts;
  s.sr = +g.meta.round;
  finishRound(s);
  renderBlanks('win');
  say('YES! 🎉');
  sfx('win');
  buzz([30, 50, 30]);
  confetti();
  replayCtl && replayCtl.cancel();
  paintStatic($('#view'), g.strokes);
  setTimeout(showResult, 1300);
}

function lose() {
  const p = g.prog, s = ensureSession();
  p.done = true; p.ok = false; p.pts = 0; p.hearts = 0;
  s.streak = 0;
  s.sr = +g.meta.round;
  finishRound(s);
  renderHearts();
  renderBlanks('lose');
  say(`It was “${g.word}”!`);
  sfx('lose');
  setTimeout(showResult, 1700);
}

function finishRound(s) {
  const p = g.prog;
  s.report = { round: +g.meta.round, ad: g.meta.dev, word: g.word, ok: p.ok, tries: p.guesses.length, pts: p.pts, rx: p.rx, note: p.note };
  saveSession(s);
  saveProgress();
  addToGallery({
    key: g.key, ts: Date.now(), payload: g.payload, word: g.word, cat: g.meta.cat, lvl: g.meta.lvl,
    artist: g.meta.from || 'Partner', guesser: myName(), mine: false,
    result: { ok: p.ok, tries: p.guesses.length, pts: p.pts, rx: p.rx, note: p.note },
  });
}

function showResult() {
  const p = g.prog, s = ensureSession();
  $('#res-badge').textContent = p.ok ? '🎉' : '🙈';
  $('#res-title').textContent = p.ok ? pick(WIN_TITLES) : pick(LOSE_TITLES);
  $('#res-word').textContent = `“${g.word}”`;
  $('#res-points').textContent = p.ok
    ? `+${p.pts} points in ${tries(p.guesses.length)}${p.bonus ? ' (🔥 streak bonus!)' : ''}`
    : 'No points this time. Streak reset.';
  $('#res-team').textContent = `Team score ${s.score} · ${coupleTitle(s.score)}${s.streak > 1 ? ` · 🔥 ${s.streak} in a row` : ''}`;
  $('#res-react-label').textContent = `React to ${g.meta.from || 'your partner'}'s art`;
  $$('#reactions button').forEach((b) => b.classList.toggle('on', b.textContent === p.rx));
  $('#res-note').value = p.note || '';
  show('result');
  requestAnimationFrame(() => paintStatic($('#res-canvas'), g.strokes));
}

function updateReaction(patch) {
  Object.assign(g.prog, patch);
  saveProgress();
  const s = getSession();
  if (s && s.report && s.report.round === +g.meta.round && s.report.ad === g.meta.dev) {
    Object.assign(s.report, patch);
    saveSession(s);
  }
  updateGalleryResult(g.key, patch);
}

async function sendResult() {
  const p = g.prog, s = ensureSession();
  const meta = {
    k: 'r', sid: s.sid, round: +g.meta.round, ad: g.meta.dev, from: myName(), dev: deviceId,
    word: g.word, ok: p.ok, tries: p.guesses.length, pts: p.pts, rx: p.rx, note: p.note,
    score: s.score, streak: s.streak, best: s.best, sr: s.sr,
  };
  const link = `${BASE}#r=${await encodePayload(meta)}`;
  shareLink(link, p.ok ? `🎉 I guessed your doodle! See how I did:` : `🙈 I couldn't guess your doodle… see what I thought:`);
}

// =====================================================================
// ARTIST RECEIVES A RESULT
// =====================================================================
function applyReport(sid, r) {
  if (!r || !r.ad || r.ad !== deviceId) return null; // only my own doodles
  return updateGalleryResult(`${sid}:${+r.round}:${r.ad}`, {
    ok: !!r.ok, tries: +r.tries || 0, pts: +r.pts || 0,
    rx: String(r.rx || '').slice(0, 4), note: String(r.note || '').slice(0, 80),
  });
}

async function openReport(data) {
  const m = data.meta;
  if (m.dev === deviceId) {
    clearHash();
    show('home');
    toast('That is your own result link. Send it to your partner!');
    return;
  }
  const s = adoptIncoming(m);
  const entry = applyReport(m.sid, m);
  const who = m.from || 'Your partner';
  const word = String(m.word || 'doodle').slice(0, 40);
  $('#rep-badge').textContent = m.rx ? String(m.rx).slice(0, 4) : (m.ok ? '🎉' : '🙈');
  $('#rep-title').textContent = m.ok ? `${who} guessed your “${word}”!` : `${who} couldn't guess your “${word}”`;
  $('#rep-sub').textContent = m.ok ? `In ${tries(+m.tries || 1)} · +${+m.pts || 0} points for the team` : 'Maybe draw it bigger next time 😄';
  const note = $('#rep-note');
  note.textContent = m.note ? `“${String(m.note).slice(0, 80)}”` : '';
  note.classList.toggle('hidden', !m.note);
  $('#rep-team').textContent = `Team score ${s.score} · ${coupleTitle(s.score)}`;
  $('#rep-polaroid').classList.toggle('hidden', !entry);
  show('report');
  if (m.ok) { confetti(); sfx('win'); }
  if (entry) {
    $('#rep-word').textContent = `“${entry.word}”`;
    try { const d = await decodePayload(entry.payload); paintStatic($('#rep-canvas'), d.strokes); } catch {}
  }
}

// =====================================================================
// INVITES (guesser asks the artist to draw)
// =====================================================================
async function sendInvite() {
  const s = ensureSession();
  const link = `${BASE}#j=${await encodePayload({ k: 'j', sid: s.sid, from: myName(), dev: deviceId })}`;
  shareLink(link, `🎨 Draw me something on Doodle Duet! I'll try to guess it.`);
}

function openInvite(data) {
  const m = data.meta;
  clearHash();
  if (m.dev === deviceId) {
    show('waiting');
    toast('That is your own invite. Send it to your partner!');
    return;
  }
  adoptIncoming(m);
  sfx('open');
  goLevel(`${m.from || 'Your partner'} is waiting for your doodle! 💌`);
}

// =====================================================================
// GALLERY
// =====================================================================
function showGallery() {
  show('gallery');
  const grid = $('#gallery-grid');
  grid.replaceChildren();
  const list = store.get('gallery', []);
  $('#gallery-empty').classList.toggle('hidden', list.length > 0);
  for (const e of list) {
    const cv = h('canvas');
    const tile = h('button', { class: 'tile', onclick: () => openViewer(e) },
      h('div', { class: 'paper' }, cv),
      h('b', {}, e.word),
      h('small', {}, `${e.mine ? 'You' : e.artist} drew · ${resultTag(e.result)}`));
    grid.append(tile);
    decodePayload(e.payload).then((d) => { e.strokes = d.strokes; paintStatic(cv, d.strokes); }).catch(() => {});
  }
}

let viewerCtl = null;
async function openViewer(e) {
  const dlg = $('#viewer');
  $('#viewer-word').textContent = `“${e.word}”`;
  const r = e.result;
  $('#viewer-meta').textContent = `${e.mine ? 'You' : e.artist} drew this · ${new Date(e.ts).toLocaleDateString()}${r ? ` · ${r.ok ? `guessed in ${tries(r.tries || 1)}` : 'not guessed'}` : ''} ${r && r.rx ? r.rx : ''}`;
  const note = $('#viewer-note');
  note.textContent = r && r.note ? `“${r.note}”` : '';
  note.classList.toggle('hidden', !(r && r.note));
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  if (!e.strokes) { try { e.strokes = (await decodePayload(e.payload)).strokes; } catch { e.strokes = []; } }
  const play = () => { viewerCtl && viewerCtl.cancel(); viewerCtl = replay($('#viewer-canvas'), e.strokes); };
  $('#viewer-replay').onclick = play;
  requestAnimationFrame(play);
}

// =====================================================================
// ROUTING (everything arrives in the URL hash, which never hits a server)
// =====================================================================
async function route() {
  const m = location.hash.match(/^#([djr])=([A-Za-z0-9_-]+)$/);
  if (!m) { show('home'); return; }
  const [, kind, payload] = m;
  let data;
  try {
    data = await decodePayload(payload);
  } catch (e) {
    console.error(e);
    showError('This link looks broken', 'It may have been cut off when it was sent. Ask your partner to copy the whole link again.');
    return;
  }
  if (kind === 'd' && data.meta.k === 'd') return openDoodle(payload, data);
  if (kind === 'r' && data.meta.k === 'r') return openReport(data);
  if (kind === 'j' && data.meta.k === 'j') return openInvite(data);
  showError('Unknown link', 'This does not look like a Doodle Duet link.');
}

// =====================================================================
// WIRING
// =====================================================================
function bind() {
  $('#btn-home').onclick = goHome;
  $('#btn-err-home').onclick = goHome;
  $('#btn-sound').onclick = () => { setMuted(!isMuted()); updateSoundBtn(); if (!isMuted()) sfx('pop'); };

  $$('.name-input').forEach((inp) => {
    inp.value = myName();
    inp.addEventListener('input', () => {
      const v = inp.value.trim().slice(0, 16);
      store.set('name', v);
      $$('.name-input').forEach((o) => { if (o !== inp) o.value = v; });
    });
  });
  $('#my-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-play').click(); });

  $('#btn-play').onclick = () => {
    if (!myName()) {
      shake($('#my-name'));
      $('#my-name').focus();
      toast('Add your name so your partner knows it’s you 🙂');
      return;
    }
    sfx('pop');
    show('role');
  };
  $('#btn-how').onclick = () => $('#how').classList.toggle('hidden');
  $('#btn-gallery').onclick = showGallery;

  $('#partner-name').addEventListener('input', (e) => {
    store.set('partner', e.target.value.trim().slice(0, 16));
    $$('.partner').forEach((el) => { el.textContent = partnerLabel(); });
  });
  $('#pick-artist').onclick = () => { sfx('pop'); goLevel(); };
  $('#pick-guesser').onclick = () => { sfx('pop'); show('waiting'); };

  $('#btn-invite').onclick = sendInvite;
  $('#btn-open-paste').onclick = () => {
    const v = $('#paste-link').value.trim();
    const i = v.indexOf('#');
    if (i < 0) { toast('That doesn’t look like a Doodle Duet link'); return; }
    const hash = v.slice(i);
    if (location.hash === hash) route(); else location.hash = hash;
  };

  $$('.level-card').forEach((b) => {
    b.onclick = () => { art.level = +b.dataset.level; art.rerolls = 2; art.pick = null; nextWord(); sfx('pop'); show('word'); };
  });
  $('#btn-reroll').onclick = () => { if (art.rerolls > 0) { art.rerolls--; nextWord(); sfx('pop'); } };
  $('#btn-start-draw').onclick = startDrawing;

  $('#draw-word-btn').onclick = () => $('#draw-word-btn').classList.toggle('secret');
  $('#tool-eraser').onclick = () => { art.pad.eraser = !art.pad.eraser; updateDrawUI(); };
  $('#tool-undo').onclick = () => art.pad.undo();
  $('#tool-clear').onclick = () => { art.pad.clear(); toast('Cleared. Tap ↩️ to bring it back.'); };
  $('#btn-done').onclick = finishDrawing;

  $('#btn-share').onclick = () => shareLink(art.link, `💌 ${myName() || 'I'} drew you a doodle! Can you guess what it is?`);
  $('#btn-copy').onclick = async () => { await copyText(art.link); toast('Link copied! 📋'); };
  $('#btn-share-home').onclick = goHome;

  $('#envelope-btn').onclick = openEnvelope;
  $('#btn-open-env').onclick = openEnvelope;
  $('#guess-form').onsubmit = (e) => { e.preventDefault(); submitGuess($('#guess-input').value); };
  $('#btn-replay').onclick = () => { fitView(); runReplay(true); };
  $('#btn-giveup').onclick = () => { if (g && !g.prog.done && confirm('Give up and reveal the word?')) lose(); };

  const rx = $('#reactions');
  REACTIONS.forEach((e) => rx.append(h('button', {
    type: 'button', 'aria-label': `React ${e}`,
    onclick: () => { const on = g.prog.rx === e ? '' : e; updateReaction({ rx: on }); $$('#reactions button').forEach((b) => b.classList.toggle('on', b.textContent === on)); if (on) { sfx('pop'); buzz(15); } },
  }, e)));
  $('#res-note').addEventListener('input', (e) => updateReaction({ note: e.target.value.slice(0, 80) }));
  $('#btn-draw-back').onclick = () => { clearHash(); goLevel(`Your turn! Draw something for ${partnerLabel()} ✏️`); };
  $('#btn-send-result').onclick = sendResult;
  $('#btn-rep-next').onclick = () => { clearHash(); show('role'); };

  $('#viewer-close').onclick = () => { viewerCtl && viewerCtl.cancel(); $('#viewer').close(); };

  new ResizeObserver(() => { if (current === 'guess' && g) { fitView(); if (!replayCtl || !replayCtl.running) paintStatic($('#view'), g.strokes); } }).observe($('#view-area'));
  window.addEventListener('hashchange', route);
}

function updateSoundBtn() { $('#btn-sound').textContent = isMuted() ? '🔇' : '🔊'; }

bind();
updateSoundBtn();
renderTeamChip();
refreshNames();
route();
