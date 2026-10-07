// 设置窗渲染层（阶段 9）。
//
// 约定：本文件是【窗口脚本】——只被 settings.html 加载，不做 require。
// preload 注入的全局 `aqi` 不可重名，一律用别名 `api`（踩过的坑）。
const api = window.aqi || null;   // ← 别名，勿改回 aqi

function log(msg) {
  try { if (api && api.log) api.log(msg); } catch (_) {}
  try { console.log('[阿七设置] ' + msg); } catch (_) {}
}
window.addEventListener('error', (e) =>
  log('ERROR: ' + (e.message || e.error) + ' @' + (e.lineno || 0)));
log('booted; aqi=' + (!!window.aqi));

const el = {
  name: document.getElementById('pet-name'),
  nameBtn: document.getElementById('btn-name'),
  top: document.getElementById('always-on-top'),
  pos: document.getElementById('pos-text'),
  resetPos: document.getElementById('btn-reset-pos'),
  reminders: document.getElementById('reminders'),
  eye: document.getElementById('eye-min'),
  sit: document.getElementById('sit-min'),
  boot: document.getElementById('start-on-boot'),
  dataDir: document.getElementById('data-dir'),
  openDir: document.getElementById('btn-open-dir'),
  dataSummary: document.getElementById('data-summary'),
  lastBackup: document.getElementById('last-backup'),
  backupBtn: document.getElementById('btn-backup'),
  backups: document.getElementById('backups'),
  ver: document.getElementById('ver'),
  toast: document.getElementById('toast')
};

let toastTimer = null;
function toast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2400);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (_) { return String(iso); }
}
function clampInt(v, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return dflt;
  return Math.min(n, 600);
}

let state = null;

function render() {
  if (!state) return;
  const s = state.settings;
  el.name.value = s.petName;
  el.top.checked = !!s.alwaysOnTop;
  el.reminders.checked = !!s.remindersEnabled;
  el.eye.value = s.eyeReminderMin;
  el.sit.value = s.sitReminderMin;
  // 开机启动以「系统登记的真实状态」为准（用户可能在系统里手动改过）
  el.boot.checked = (typeof state.loginItem === 'boolean') ? state.loginItem : !!s.startOnBoot;
  el.pos.textContent = s.position
    ? `(${s.position.x}, ${s.position.y})`
    : '未记录（默认位置）';

  const info = state.appInfo || {};
  el.dataDir.textContent = info.dataDir || '—';
  el.dataDir.title = info.dataDir || '';
  el.dataSummary.textContent = `出勤 ${info.attendanceDays || 0} 天 · 工作记录 ${info.recordFiles || 0} 个 · 约 ${fmtBytes(info.dataBytes)}`;
  el.lastBackup.textContent = info.lastBackup
    ? `${fmtDate(info.lastBackup.createdAt)}（${fmtBytes(info.lastBackup.sizeBytes)}）`
    : '还没有备份';
  el.ver.textContent = '阿七 V' + (state.version || '1.0');
  renderBackups(state.backups || []);
}

function renderBackups(list) {
  if (!list.length) {
    el.backups.innerHTML = '<div class="backup-empty">还没有备份。建议每天收工后点一次「立即备份」。</div>';
    return;
  }
  el.backups.innerHTML = '';
  list.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'backup-item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<b>${esc(fmtDate(b.createdAt))}</b> <small>${esc(b.name)} · ${esc(fmtBytes(b.sizeBytes))}</small>`;

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '恢复';
    btn.addEventListener('click', () => askRestore(b.name, row));

    row.appendChild(meta);
    row.appendChild(btn);
    el.backups.appendChild(row);
  });
}

// 恢复 = 覆盖当前数据，属于危险操作：必须内联二次确认，且说明"恢复前会自动再备份一次"
function askRestore(name, row) {
  const old = document.querySelectorAll('.confirm');
  for (let i = 0; i < old.length; i += 1) old[i].remove();

  const box = document.createElement('div');
  box.className = 'confirm';
  const t1 = document.createElement('div');
  t1.innerHTML = `⚠ 确认用备份 <b>${esc(name)}</b> 覆盖当前数据？`;
  const t2 = document.createElement('div');
  t2.textContent = '当前的考勤、工作记录、待办、等级与设置会被替换。程序会先把当前数据自动备份一次，之后仍可从列表里找回。';
  const acts = document.createElement('div');
  acts.className = 'acts';

  const ok = document.createElement('button');
  ok.className = 'btn danger';
  ok.textContent = '确认恢复';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = '取消';

  cancel.addEventListener('click', () => box.remove());
  ok.addEventListener('click', async () => {
    ok.disabled = true; cancel.disabled = true;
    ok.textContent = '恢复中…';
    let r = null;
    try { r = await api.restoreBackup(name); } catch (e) { r = { ok: false, reason: e && e.message }; }
    box.remove();
    if (r && r.ok) {
      toast('已恢复到 ' + name + (r.safetyBackup ? '（当前数据已另存为 ' + r.safetyBackup + '）' : ''));
      await reload();
    } else {
      toast('恢复失败：' + ((r && r.reason) || '未知错误'));
    }
  });

  acts.appendChild(ok);
  acts.appendChild(cancel);
  box.appendChild(t1); box.appendChild(t2); box.appendChild(acts);
  row.insertAdjacentElement('afterend', box);
}

async function reload() {
  if (!api || !api.getSettingsState) { log('桥未就绪'); return; }
  try {
    state = await api.getSettingsState();
    render();
  } catch (e) { log('reload failed: ' + (e && e.message)); }
}

async function save(patch) {
  try {
    const r = await api.saveSettings(patch);
    if (r && r.ok) { toast('已保存'); await reload(); }
    else toast('保存失败：' + ((r && r.reason) || '未知'));
  } catch (e) { toast('保存失败：' + (e && e.message)); }
}

// ===== 各控件 =====
el.top.addEventListener('change', () => save({ alwaysOnTop: el.top.checked }));
el.reminders.addEventListener('change', () => save({ remindersEnabled: el.reminders.checked }));
el.eye.addEventListener('change', () => save({ eyeReminderMin: clampInt(el.eye.value, 60) }));
el.sit.addEventListener('change', () => save({ sitReminderMin: clampInt(el.sit.value, 90) }));
el.boot.addEventListener('change', () => save({ startOnBoot: el.boot.checked }));

el.nameBtn.addEventListener('click', async () => {
  const v = String(el.name.value || '').trim();
  if (!v) { toast('名字不能为空'); return; }
  try {
    const r = await api.setPetName(v);
    if (r && r.ok) { toast('名字已改为「' + r.name + '」'); await reload(); }
    else if (r && r.reason === 'too_long') toast('名字最多 12 个字');
    else toast('改名失败');
  } catch (e) { toast('改名失败：' + (e && e.message)); }
});

el.resetPos.addEventListener('click', async () => {
  try {
    const r = await api.resetPosition();
    if (r && r.ok) { toast('阿七已回到屏幕中央'); await reload(); }
    else toast('操作失败');
  } catch (e) { toast('操作失败：' + (e && e.message)); }
});

el.openDir.addEventListener('click', () => { if (api && api.openDataDir) api.openDataDir(); });

el.backupBtn.addEventListener('click', async () => {
  el.backupBtn.disabled = true;
  try {
    const r = await api.backupNow();
    if (r && r.ok) { toast('已备份：' + r.name); await reload(); }
    else toast('备份失败：' + ((r && r.reason) || '未知'));
  } catch (e) { toast('备份失败：' + (e && e.message)); }
  el.backupBtn.disabled = false;
});

reload();
