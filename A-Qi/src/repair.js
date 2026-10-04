// src/repair.js —— 阶段 4：补录 / 修正考勤 窗口的渲染层
//
// ⚠️ 命名铁律：绝不写 `const aqi = window.aqi`。
// preload 通过 contextBridge.exposeInMainWorld('aqi', …) 注入的全局 aqi 是不可配置属性，
// 脚本顶层再声明同名 const 会抛 SyntaxError，整份脚本一行都不执行（阶段 2 踩过的坑）。
// 统一用 api 引用。

const api = window.aqi || null;

const elPending = document.getElementById('pending');
const elForm = document.getElementById('form');
const elResult = document.getElementById('result');
const fDate = document.getElementById('f-date');
const fStart = document.getElementById('f-start');
const fEnd = document.getElementById('f-end');
const btnSave = document.getElementById('btn-save');
const btnIgnore = document.getElementById('btn-ignore');
const btnClose = document.getElementById('btn-close');

let queue = [];

function log(m) { try { if (api && api.log) api.log('[repair] ' + m); } catch (_) {} }

const KIND_TEXT = { forgot_out: '忘记下工', forgot_in: '忘记上工' };

const REASON_TEXT = {
  bad_date: '日期格式不对（应为 YYYY-MM-DD）',
  bad_start: '上工时间格式不对',
  bad_end: '下工时间格式不对',
  bad_range: '下工时间必须晚于上工时间',
  future: '不能补录未来的日期',
  has_record: '这一天已有出勤记录，不能标记为“没上班”'
};

function reasonText(code) {
  if (!code) return '操作失败';
  return REASON_TEXT[code] || ('操作失败（' + code + '）');
}

function showResult(html, cls) {
  elResult.className = 'result' + (cls ? ' ' + cls : '');
  elResult.innerHTML = html || '';
}

function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  return String(Math.floor(m / 60)).padStart(2, '0') + '小时' + String(m % 60).padStart(2, '0') + '分钟';
}

// 把某个待处理项填入表单
function fillForm(item) {
  if (!item) return;
  fDate.value = item.date;
  if (item.kind === 'forgot_out' && item.startHM) {
    fStart.value = item.startHM;   // 上工时间已知，只需补下工
    fEnd.value = '';
  } else {
    fStart.value = '08:00';
    fEnd.value = '18:00';
  }
}

function renderPending(list) {
  if (!list || !list.length) {
    elPending.innerHTML = '<div class="ok">✔ 没有待处理的异常记录。</div>';
    return;
  }
  elPending.innerHTML = list.map((it) =>
    '<div class="item" data-date="' + it.date + '">'
    + '<b>' + it.date + '</b> · ' + (KIND_TEXT[it.kind] || it.kind)
    + (it.startHM
      ? '　上工 ' + it.startHM + '，缺下工时间'
      : '　该工作日没有任何出勤记录')
    + '</div>'
  ).join('') + '<div class="tip">点上面任意一行 → 自动填入下方表单</div>';

  elPending.querySelectorAll('.item').forEach((el) => {
    el.addEventListener('click', () => {
      const it = queue.find((x) => x.date === el.dataset.date);
      fillForm(it);
      showResult('');
    });
  });
}

async function refresh() {
  if (!api) { renderPending([]); return; }
  try {
    queue = await api.getPending();
  } catch (e) {
    log('getPending failed: ' + (e && e.message));
    queue = [];
  }
  if (!Array.isArray(queue)) queue = [];
  renderPending(queue);
  if (queue.length) fillForm(queue[0]);
}

// ===== 保存补录 =====
elForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!api) return;
  btnSave.disabled = true;
  try {
    const r = await api.repair({ date: fDate.value, start: fStart.value, end: fEnd.value });
    if (r && r.ok) {
      const rec = r.record;
      const s0 = rec.sessions[0];
      showResult(
        '✔ 已补录 <b>' + rec.date + '</b>：上工 ' + s0.start + ' → 下工 ' + s0.end
        + '，实际工作 <b>' + fmtDuration(rec.totalMinutes) + '</b>，获得 <b>+' + rec.exp.toFixed(1) + ' EXP</b>。'
        + '<br>对应的当天工作记录 TXT 已同步（考勤段标注“补录”）。',
        'ok'
      );
      await refresh();
    } else {
      showResult('✘ ' + reasonText(r && r.reason), 'err');
    }
  } catch (err) {
    showResult('✘ 保存失败：' + (err && err.message), 'err');
  }
  btnSave.disabled = false;
});

// ===== 这天没上班（忽略） =====
btnIgnore.addEventListener('click', async () => {
  if (!api) return;
  const d = fDate.value;
  if (!d) { showResult('✘ 请先选择日期', 'err'); return; }
  try {
    const r = await api.ignoreDay(d);
    if (r && r.ok) {
      showResult('✔ 已记录：<b>' + d + '</b> 没上班，阿七以后不会再问这一天。', 'ok');
      await refresh();
    } else {
      showResult('✘ ' + reasonText(r && r.reason), 'err');
    }
  } catch (err) {
    showResult('✘ 操作失败：' + (err && err.message), 'err');
  }
});

// ===== 关闭 =====
btnClose.addEventListener('click', () => { if (api) api.closeRepair(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && api) api.closeRepair(); });

log('booted');
refresh();
