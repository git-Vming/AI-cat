// src/work-record.js
// 阶段 3：工作记录 TXT（用户真正拥有的数据）
//
// 设计铁律：
//  1. TXT 是【用户的】文件：程序只负责「生成骨架 + 同步考勤段」，绝不动用户手写的内容。
//  2. 只同步两个系统段：【考勤】（上工/午休/下工/时长/EXP）与【阿七】（今日获得EXP）。
//     【工作内容】【今日完成】【今日问题】【明日待办】全部原样保留。
//  3. 文件缺失 → 生成完整模板；已存在 → 定点替换，不做整篇重写。
//  4. 纯文本、UTF-8，换电脑/换程序都能继续用。
//
// 模板以《技术实现规格》§26 为基础；因本项目的交互模型是"一天只点两次（上工/下工）、
// 午休由算法自动排除"，故「午休」行只在本次工作确实跨过午休区间的工作日出现，并标注"（自动扣除）"。

const fs = require('fs');
const path = require('path');

// 段标题（顺序即模板顺序）
const H_ATT = '【考勤】';
const H_WORK = '【工作内容】';
const H_DONE = '【今日完成】';
const H_PROB = '【今日问题】';
const H_KNOW = '【今日新知】';
const H_NODE = '【项目节点】';
const H_TODO = '【明日待办】';
const H_ATQI = '【阿七】';
const HEADERS = [H_ATT, H_WORK, H_DONE, H_PROB, H_KNOW, H_NODE, H_TODO, H_ATQI];

function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr(d) {
  const x = d || new Date();
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}
function round1(x) { return Math.round(x * 10) / 10; }
function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// 分钟 → "08小时03分钟"
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(h)}小时${pad2(mm)}分钟`;
}

function recordDir(root) { return path.join(root, 'WorkRecords'); }
function recordPath(root, date) { return path.join(recordDir(root), `${date}.txt`); }

function expTextOf(rec) {
  if (!rec) return '—';
  if (rec.status === 'completed') return round1(rec.exp || 0).toFixed(1);
  return '—';
}

// 【考勤】段正文（不含尾部空行）
function attendanceBlock(rec, opts) {
  const o = opts || {};
  const lunch = (Array.isArray(o.lunch) && o.lunch.length === 2) ? o.lunch : ['12:00', '14:00'];
  const lines = [H_ATT];

  if (!rec || !Array.isArray(rec.sessions) || !rec.sessions[0]) {
    lines.push('（今日还没有上工记录）');
    lines.push('');
    lines.push('实际工作时长：—');
    lines.push('今日EXP：—');
    return lines.join('\n');
  }

  const s0 = rec.sessions[0];
  const start = s0.start || '--:--';
  const end = s0.end || '--:--';
  const incomplete = rec.status === 'incomplete';

  lines.push(`上工：${start}`);

  // 工作日的「午休」行：仅当本次工作确实跨过午休区间时才写（并注明是自动扣除）
  const spansLunch = rec.type === 'workday'
    && rec.status === 'completed'
    && toMin(start) < toMin(lunch[1]) && toMin(end) > toMin(lunch[0]);
  if (spansLunch) lines.push(`午休：${lunch[0]}–${lunch[1]}（自动扣除）`);

  lines.push(`下工：${incomplete ? '（未记录）' : end}`);
  lines.push('');

  if (rec.status === 'completed') {
    lines.push(`实际工作时长：${fmtDuration(rec.totalMinutes)}`);
    lines.push(`今日EXP：${round1(rec.exp || 0).toFixed(1)}`);
    // 阶段 4（技术规格 §22）：补录产生的记录需在记录中注明
    if (rec.source === 'manual_repair') lines.push('考勤状态：补录');
  } else if (rec.status === 'working') {
    lines.push('实际工作时长：（进行中）');
    lines.push('今日EXP：（进行中）');
  } else {
    lines.push('实际工作时长：（待补录）');
    lines.push('今日EXP：（待补录）');
  }
  return lines.join('\n');
}

// 完整模板（按 V-ming 2026-10-04 定稿格式）
function buildRecordContent(date, rec, opts) {
  return [
    `${date}｜工作记录`,
    '',
    attendanceBlock(rec, opts),
    '',
    H_WORK,
    '注：工作类型分为设计、服务、对接。在这里填写今日的工作内容。',
    '',
    '08:00~12:00：',
    '',
    '',
    '14:00~18:00：',
    '',
    '',
    '是否加班：是/否',
    '',
    '18:00~20:00：',
    '',
    '',
    H_DONE,
    '',
    '在这里填写今日完成事项。',
    '',
    H_PROB,
    '',
    '在这里填写工作过程中遇到的问题。',
    '',
    H_KNOW,
    '',
    '在这里填写工作过程中学习到的新知识。',
    '',
    H_NODE,
    '',
    '在这里填写今日分配的项目的交图日期。',
    '例如：南安半导体项目：交图日期2026-10-30；今日由师傅通过微信告知项目节点。',
    '',
    H_TODO,
    '',
    '1.',
    '2.',
    '3.',
    '',
    H_ATQI,
    `今日获得EXP：${expTextOf(rec)}`,
    ''
  ].join('\n');
}

// 定点替换某个段（从 header 到下一个已知 header / 文末），保留其余内容
function replaceSection(text, header, newBody) {
  const i = text.indexOf(header);
  if (i < 0) return null;
  let j = text.length;
  for (const h of HEADERS) {
    if (h === header) continue;
    const k = text.indexOf(h, i + header.length);
    if (k >= 0 && k < j) j = k;
  }
  const head = text.slice(0, i);
  const tail = text.slice(j).replace(/^\n+/, '');
  if (!tail) return head + newBody + '\n';
  return head + newBody + '\n\n' + tail;
}

// 生成 / 同步工作记录。返回 { created, path }
// rec 为空（今天没上工）时也会生成骨架，方便用户先写内容。
function syncRecord(root, date, rec, opts) {
  const dir = recordDir(root);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const p = recordPath(root, date);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, buildRecordContent(date, rec, opts), 'utf8');
    return { created: true, path: p };
  }

  let txt = fs.readFileSync(p, 'utf8');

  // 1) 同步【考勤】段
  const att = attendanceBlock(rec, opts);
  if (txt.includes(H_ATT)) {
    const out = replaceSection(txt, H_ATT, att);
    if (out !== null) txt = out;
  } else {
    // 用户把文件改得没有【考勤】段了 → 插在标题行之后，不破坏其它内容
    const nl = txt.indexOf('\n');
    txt = (nl >= 0)
      ? txt.slice(0, nl + 1) + '\n' + att + '\n' + txt.slice(nl + 1)
      : txt + '\n\n' + att + '\n';
  }

  // 2) 同步【阿七】段
  const atqi = `${H_ATQI}\n今日获得EXP：${expTextOf(rec)}`;
  if (txt.includes(H_ATQI)) {
    const out = replaceSection(txt, H_ATQI, atqi);
    if (out !== null) txt = out;
  }

  fs.writeFileSync(p, txt, 'utf8');
  return { created: false, path: p };
}

function readRecord(root, date) {
  const p = recordPath(root, date);
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

// 历史记录（按日期倒序）
function listRecords(root) {
  const dir = recordDir(root);
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return []; }
  return files
    .filter(f => /^\d{4}-\d{2}-\d{2}\.txt$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const p = path.join(dir, f);
      let size = 0, mtime = '';
      try { const st = fs.statSync(p); size = st.size; mtime = st.mtime.toISOString(); } catch (_) {}
      return { date: f.replace(/\.txt$/, ''), file: f, path: p, size, mtime };
    });
}

module.exports = {
  HEADERS, H_ATT, H_WORK, H_DONE, H_PROB, H_KNOW, H_NODE, H_TODO, H_ATQI,
  todayStr, round1, fmtDuration,
  recordDir, recordPath, attendanceBlock, buildRecordContent,
  syncRecord, readRecord, listRecords
};
