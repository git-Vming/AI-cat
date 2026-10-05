// src/todo.js
// 阶段 5：今日待办（纯函数，便于无 GUI 单测）
//
// 规则来自《技术实现规格》§27 / 《README》§十六：
//   程序读取【前一天】工作记录 TXT 里的【明日待办】编号列表 → 成为【今日】的待办。
//   待办勾选状态存在 data/tasks.json，**绝不改写 TXT**（规格 §28：职责分离）。
//
// ⚠️ 注意：本文件是【纯逻辑模块】（被主进程 require）；
//   【窗口脚本】是同目录的 `src/todo-window.js`。两者用途不同，切勿混写。

const H_TODO = '【明日待办】';

// 所有段标题（用于界定【明日待办】段的结束位置）
const HEADERS = [
  '【考勤】', '【工作内容】', '【今日完成】', '【今日问题】',
  '【今日新知】', '【项目节点】', H_TODO, '【阿七】'
];

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 前一天（用显式年月日构造，避免时区/字符串减法问题；支持跨月跨年）
function prevDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() - 1);
  return fmtDate(base);
}

// 从某天的工作记录文本中解析【明日待办】条目
// 会去掉：编号（1. / 1、 / 1) / 1 空格）、项目符号（- * ·）、勾选框（□ ☑ ✅ ✔）
// 纯编号无内容的占位行（如模板里的 "1." / "2." / "3."）会被忽略。
function parseTodoLines(text) {
  if (!text) return [];
  const i = text.indexOf(H_TODO);
  if (i < 0) return [];

  let body = text.slice(i + H_TODO.length);
  let end = body.length;
  for (const h of HEADERS) {
    if (h === H_TODO) continue;
    const k = body.indexOf(h);
    if (k >= 0 && k < end) end = k;
  }
  body = body.slice(0, end);

  const out = [];
  for (const raw of body.split(/\r?\n/)) {
    let line = String(raw).trim();
    if (!line) continue;
    line = line.replace(/^(?:\d+\s*[.、)．]|\d+\s+)\s*/, '');   // 编号
    line = line.replace(/^[-*•·]\s*/, '');                      // 项目符号
    line = line.replace(/^[□☑☐✅✔]\s*/, '');                     // 勾选框
    line = line.trim();
    if (!line) continue;                                        // "1." 这类空占位
    out.push(line);
  }
  return out;
}

// 把已保存的完成状态合并到条目上（按文本匹配；文本被改过则视为未完成，安全）
function mergeState(items, saved) {
  const list = Array.isArray(saved) ? saved : [];
  return (items || []).map((text) => {
    const hit = list.find((x) => x && x.text === text);
    return { text, completed: !!(hit && hit.completed) };
  });
}

// 展示用文本（□ 未完成 / ☑ 已完成）
function fmtTodos(items) {
  return (items || []).map((it) => (it.completed ? '☑ ' : '□ ') + it.text);
}

function countDone(items) {
  const list = items || [];
  return { total: list.length, done: list.filter((x) => x && x.completed).length };
}

module.exports = {
  H_TODO, HEADERS,
  prevDate, parseTodoLines, mergeState, fmtTodos, countDone
};
