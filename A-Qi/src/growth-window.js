// src/growth-window.js —— 阶段 7：互动 + 宠物状态 窗口的渲染层
//
// ⚠️ 命名铁律：绝不写 `const aqi = window.aqi`（contextBridge 注入的全局 aqi 是不可配置属性，
// 同名 const 会抛 SyntaxError 让整份脚本不执行）。统一用 api。
//
// 注意：本文件是【窗口脚本】；同目录的 `src/growth.js` 是【成长/互动纯函数模块】（被主进程 require）。

const api = window.aqi || null;

const elSub = document.getElementById('interact-sub');
const elActs = document.getElementById('acts');
const elRows = document.getElementById('status-rows');
const elUnlocks = document.getElementById('unlocks');
const elResult = document.getElementById('result');
const btnClose = document.getElementById('btn-close');

let data = null;

function log(m) { try { if (api && api.log) api.log('[growth] ' + m); } catch (_) {} }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function showResult(html, cls) {
  elResult.className = 'result' + (cls ? ' ' + cls : '');
  elResult.innerHTML = html || '';
}

// ---------- 互动 ----------
function renderActions(d, busyKey) {
  const acts = Array.isArray(d && d.actions) ? d.actions : [];
  const totalLeft = acts.reduce((s, a) => s + (a.remaining || 0), 0);
  elSub.textContent = `好感度 ${d.affection || 0}　今日还可互动 ${totalLeft} 次`;

  elActs.innerHTML = acts.map((a) => (
    `<button type="button" class="act" data-key="${esc(a.key)}"${(a.remaining <= 0 || busyKey) ? ' disabled' : ''}>`
    + `<span class="act-name">${esc(a.emoji)} ${esc(a.label)}</span>`
    + `<span class="act-left">今日剩余 ${a.remaining}/${a.dailyLimit}</span>`
    + '</button>'
  )).join('');

  elActs.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => doInteract(btn.dataset.key));
  });
}

async function doInteract(key) {
  if (!api || !api.interact) return;
  showResult('');
  try {
    const r = await api.interact(key);
    if (r && r.ok) {
      showResult(`${esc(r.message)}　好感度 <b>+${r.affectionDelta}</b>（现在 <b>${r.affection}</b>）`
        + `　当前状态：<b>${esc(r.stateText || '')}</b>`, 'ok');
      await refresh();
    } else {
      showResult('✘ ' + reasonText(r && r.reason), 'err');
    }
  } catch (e) {
    showResult('✘ 互动失败：' + esc(e && e.message), 'err');
  }
}

function reasonText(code) {
  return ({
    daily_limit: '今天的次数用完啦，明天再来陪阿七吧',
    unknown_action: '不认识的动作'
  })[code] || ('互动失败（' + code + '）');
}

// ---------- 宠物状态 ----------
// 2026-10-07：顶部用《阿七形象资产》原画显示"当前心情"（表情设定）与"当前场景"（场景互动）
const elHeroMood = document.getElementById('hero-mood');
const elHeroScene = document.getElementById('hero-scene');
const elHeroState = document.getElementById('hero-state');
const elHeroHint = document.getElementById('hero-hint');

const MOOD_LIST = ['normal', 'happy', 'surprise', 'shy', 'sleepy', 'angry', 'sad', 'tilt'];
const SCENE_LIST = ['work', 'stretch', 'drink', 'eat'];
// 心情 → 一句人话，让"头像换了一张脸"有解释
const MOOD_TEXT = {
  normal: '阿七安安静静地看着你',
  happy: '阿七现在很开心',
  surprise: '阿七在提醒你注意身体',
  shy: '阿七被摸头了，有点害羞',
  sleepy: '阿七困了',
  angry: '阿七有点小情绪（有几天忘记打卡还没补哦）',
  sad: '阿七有点没精神',
  tilt: '阿七歪着头看你，等你安排今天的活'
};
const SCENE_TEXT = {
  work: '正在你旁边一起工作',
  stretch: '歇一会儿，伸个懒腰',
  drink: '记得喝水哦',
  eat: '正在吃饭，补充能量'
};

function renderHero(d) {
  const mood = MOOD_LIST.indexOf(d.mood) >= 0 ? d.mood : 'normal';
  const scene = SCENE_LIST.indexOf(d.scene) >= 0 ? d.scene : 'work';
  if (elHeroMood) elHeroMood.src = '../assets/pet/expr_' + mood + '.png';
  if (elHeroScene) elHeroScene.src = '../assets/pet/scene_' + scene + '.png';
  if (elHeroState) elHeroState.textContent = `${d.stateEmoji || ''} ${d.stateText || ''}`.trim();
  if (elHeroHint) elHeroHint.textContent = (MOOD_TEXT[mood] || '') + '　·　' + (SCENE_TEXT[scene] || '');
}

function renderStatus(d) {
  renderHero(d);
  const rows = [
    ['状态', `${d.stateEmoji || ''} ${d.stateText || ''}`.trim(), 'accent'],
    ['等级', `Lv.${d.level}（${(d.exp || 0).toFixed(1)}/${d.expPerLevel}）`, ''],
    ['累计 EXP', `${(d.totalExp || 0).toFixed(1)}　（只来自真实工作时长）`, 'dim'],
    ['好感度', String(d.affection || 0), 'accent'],
    ['陪伴天数', `${d.companionDays} 天（自 ${d.createdAt}）`, ''],
    ['互动总次数', String(d.interactionCount || 0), '']
  ];
  elRows.innerHTML = rows.map(([k, v, cls]) => (
    `<div class="row"><span class="k">${esc(k)}</span><span class="v ${cls}">${esc(v)}</span></div>`
  )).join('');
}

function renderUnlocks(d) {
  const all = Array.isArray(d.unlockList) ? d.unlockList : [];
  const has = Array.isArray(d.unlockedItems) ? d.unlockedItems : [];
  if (!all.length) { elUnlocks.innerHTML = '<span class="chip locked">暂无</span>'; return; }
  elUnlocks.innerHTML = all.map((u) => {
    const got = has.includes(u.id);
    return got
      ? `<span class="chip">${esc(u.emoji)} ${esc(u.name)}</span>`
      : `<span class="chip locked">🔒 Lv.${u.level} ${esc(u.name)}</span>`;
  }).join('');
}

function renderAll(d) {
  data = d || {};
  renderActions(data, false);
  renderStatus(data);
  renderUnlocks(data);
}

async function refresh() {
  if (!api) return;
  try {
    const d = await api.getGrowth();
    renderAll(d);
  } catch (e) {
    log('load failed: ' + (e && e.message));
    showResult('✘ 加载失败：' + esc(e && e.message), 'err');
  }
}

// ---------- 关闭 / 分区定位 ----------
btnClose.addEventListener('click', () => { if (api) api.closeGrowth(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && api) api.closeGrowth(); });

// 托盘点「🎒 宠物状态」时滚动到状态区；点「❤️ 互动」时回到互动区。窗口复用，同时刷新数据。
if (api && api.onGrowthFocus) {
  api.onGrowthFocus((sec) => {
    const el = document.getElementById(sec === 'status' ? 'sec-status' : 'sec-interact');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refresh();
  });
}

log('booted');
refresh();
