const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  ensureDataLayer, punchIn, punchOut, getStatus, resumeIncomplete, getLevelInfo,
  readJson, todayStr,
  // 阶段 4
  repairAttendance, ignoreDay, findPendingRepairs,
  // 阶段 5
  getTodos, setTodoDone, getStats,
  // 阶段 6
  getReminderSettings, updateSettings,
  // 阶段 7
  getGrowth, interact, recomputeAll,
  // 阶段 9
  getSettingsSummary, setPetName, backupData, listBackups, restoreBackup, getAppInfo
} = require('./src/data-store');
const wt = require('./src/work-time');
const wr = require('./src/work-record');
const tf = require('./src/tray-format');
const rm = require('./src/reminder');
const growth = require('./src/growth');

let mainWindow = null;
let tray = null;
let repairWindow = null;   // 阶段 4：补录 / 修正考勤窗口（普通窗口，非自绘面板）
let todoWindow = null;     // 阶段 5：今日待办 + 工作统计窗口（同样用普通窗口）
let bubbleWindow = null;   // 阶段 6：提醒气泡（独立无边框小窗，贴在阿七旁边）
let growthWindow = null;   // 阶段 7：互动 + 宠物状态窗口（同样用普通窗口）
let menuWindow = null;     // 阶段 8：点击阿七弹出的功能菜单（独立无边框小窗）
let petStateTimer = null;  // 阶段 8：宠物状态推送定时器（驱动表情/动作切换）
let settingsWindow = null; // 阶段 9：设置窗口（普通窗口）

// 数据根目录：打包后取 exe 同目录（保证数据与程序分离、整体可迁移）；
// 开发期取项目根目录。
function getAppRoot() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return __dirname;
}

// ===== 诊断日志（无 GUI 环境下定位问题的唯一可靠手段） =====
function logLine(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(path.join(getAppRoot(), 'diag.log'), line, 'utf8');
  } catch (_) { /* 日志失败不影响主流程 */ }
}

// ===== GPU 兜底 =====
// 透明窗口在部分显卡驱动 / 远程会话下可能出现 GPU 进程反复崩溃，进而拖死渲染进程。
// 策略：单次运行内 GPU 进程崩溃达到阈值(3次) → 写入标记 → 下次启动自动软件渲染。
// 正常 GPU 环境不会触发，因此对绝大多数用户零影响；如需恢复，删除 data/.software-render。
function markerPath() { return path.join(getAppRoot(), 'data', '.software-render'); }
function readMarker() { try { return fs.existsSync(markerPath()); } catch (_) { return false; } }
// 单次运行内 GPU 崩溃计数；达到阈值才落标记（避免误触发导致透明窗口降级）
let gpuCrashThisRun = 0;
const GPU_CRASH_THRESHOLD = 3;
function bumpGpuCrash() {
  gpuCrashThisRun += 1;
  logLine(`[main] GPU 崩溃(本次运行第 ${gpuCrashThisRun} 次)`);
  if (gpuCrashThisRun >= GPU_CRASH_THRESHOLD && !readMarker()) {
    try {
      fs.writeFileSync(markerPath(),
        `auto: GPU 进程反复崩溃（本次运行 ${gpuCrashThisRun} 次），已启用软件渲染兜底。\n` +
        `如需恢复硬件加速，删除本文件即可。\n`, 'utf8');
      logLine('[main] GPU 反复崩溃 → 已写入软件渲染标记（下次启动生效）');
    } catch (_) {}
  }
}
if (readMarker()) {
  app.disableHardwareAcceleration();
  logLine('[main] 检测到软件渲染标记 → disableHardwareAcceleration()');
}

// 启动第一行日志：**确认 main.js 真的被加载**。
// 排查"双击没反应 / 打包后启动即退出"这类问题时，这一行是分水岭 ——
// 有它说明主进程跑起来了（问题在窗口/渲染层），没有它说明 Electron 根本没找到 app。
logLine(`[main] boot v${app.getVersion()} packaged=${app.isPackaged} `
  + `execPath=${process.execPath} resources=${process.resourcesPath}`);

function createWindow() {
  const root = getAppRoot();
  ensureDataLayer(root); // 阶段 1：初始化 data/ WorkRecords/ backup/ 与默认 JSON
  logLine('[main] createWindow');

  mainWindow = new BrowserWindow({
    width: 180,
    height: 200,
    show: false,         // 阶段 8：先恢复桌面位置再显示，避免启动瞬间闪一下
    transparent: true,   // 透明背景
    frame: false,        // 无边框
    alwaysOnTop: true,   // 始终置顶
    skipTaskbar: true,   // 不在任务栏显示
    resizable: false,    // 透明窗口必须不可缩放（官方限制）
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 关键诊断：渲染进程是否加载成功 / preload 是否报错 / 是否有 JS 异常
  const wc = mainWindow.webContents;
  wc.on('did-finish-load', () => logLine('[main] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc, url) => logLine(`[main] did-fail-load code=${code} desc=${desc} url=${url}`));
  wc.on('preload-error', (e, p, err) => logLine(`[main] preload-error path=${p} err=${err && err.message}`));
  wc.on('unresponsive', () => logLine('[main] renderer unresponsive'));
  wc.on('console-message', (...args) => {
    // Electron 31: (event, level, message, line, sourceId)
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    const src = (maybe && typeof maybe === 'object') ? maybe.sourceId : args[4];
    logLine(`[renderer-console] ${msg}  <${src}>`);
  });

  // 渲染进程崩溃 → 记录 + 尝试自动重载（最多 3 次，避免死循环）
  let reloadTries = 0;
  wc.on('render-process-gone', (e, d) => {
    logLine(`[main] render-process-gone ${JSON.stringify(d)}`);
    if (d && (d.reason === 'crashed' || d.reason === 'oom')) {
      if (reloadTries < 3 && mainWindow && !mainWindow.isDestroyed()) {
        reloadTries += 1;
        logLine(`[main] 尝试重载渲染进程 (${reloadTries}/3)`);
        setTimeout(() => { try { mainWindow.webContents.reload(); } catch (_) {} }, 600);
      }
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 阶段 8：恢复上次桌面位置后再显示（applySavedPosition 为函数声明，已提升）
  mainWindow.once('ready-to-show', () => {
    applySavedPosition();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    logLine('[main] window shown');
  });

  // 注：拖动由渲染层（app.js）用 pointer 事件计算位移、经 aqi:drag 调用 setPosition 实现；
  // 不挂 -webkit-app-region 拖拽区（OS 会把它当非客户区，吞掉 mouseup/click），
  // 也不对整窗 setIgnoreMouseEvents（会吞掉全部鼠标事件）。
  mainWindow.on('closed', () => { mainWindow = null; logLine('[main] window closed'); });
}

// ===== 阶段 3：工作记录 TXT =====
// 记录文件在 WorkRecords/YYYY-MM-DD.txt；程序只同步【考勤】与【阿七】两段，
// 用户手写的【工作内容】【今日完成】【今日问题】【明日待办】永不被覆盖。

function recordOpts() {
  const s = readJson(path.join(getAppRoot(), 'data', 'settings.json'), {});
  const lunch = (s.work && Array.isArray(s.work.lunch) && s.work.lunch.length === 2)
    ? s.work.lunch
    : [s.lunchStart || '12:00', s.lunchEnd || '14:00'];
  return { lunch };
}

// 同步某一天的记录（该天没有出勤记录时不生成文件）
function syncRecordFor(date) {
  const root = getAppRoot();
  const att = readJson(path.join(root, 'data', 'attendance.json'), {});
  const rec = att[date];
  if (!rec) return false;
  try {
    const r = wr.syncRecord(root, date, rec, recordOpts());
    logLine(`[record] ${r.created ? 'created' : 'updated'} ${date}`);
    return true;
  } catch (e) {
    logLine('[record] sync failed: ' + (e && e.message));
    return false;
  }
}

function syncTodayRecord() { return syncRecordFor(todayStr()); }

// 启动时补齐「跨天未下工」那几天的记录，使其明确标注"下工（未记录）/待补录"
function syncIncompleteRecords() {
  const att = readJson(path.join(getAppRoot(), 'data', 'attendance.json'), {});
  for (const [date, rec] of Object.entries(att)) {
    if (rec && rec.status === 'incomplete') syncRecordFor(date);
  }
}

// 用系统默认程序打开今日记录（不存在则先生成骨架，方便用户直接写内容）
function openTodayRecord() {
  const root = getAppRoot();
  const date = todayStr();
  const p = wr.recordPath(root, date);
  if (!fs.existsSync(p)) {
    try { wr.syncRecord(root, date, null, recordOpts()); } catch (e) { logLine('[record] create failed: ' + (e && e.message)); }
  }
  logLine('[record] open ' + p);
  shell.openPath(p).then((err) => { if (err) logLine('[record] open failed: ' + err); });
}

function openRecordsFolder() {
  const dir = wr.recordDir(getAppRoot());
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  logLine('[record] open folder ' + dir);
  shell.openPath(dir).then((err) => { if (err) logLine('[record] open folder failed: ' + err); });
}

// ===== 阶段 4：补录 / 修正考勤窗口 =====
// 选型说明：用【普通窗口】（系统标题栏 + 原生关闭按钮），不用自绘无边框面板。
// 原因：补录需要日期/时间输入控件，且必须能"关得掉"——自绘面板在这方面既复杂又易踩坑
// （曾因改动量与可用性问题被 PM 否决）。普通窗口天然有这个能力，改动量也最小。
function createRepairWindow() {
  repairWindow = new BrowserWindow({
    width: 420,
    height: 486,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '补录 / 修正考勤 · 阿七',
    autoHideMenuBar: true,
    backgroundColor: '#17171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 与主窗口同样的诊断埋点，便于排查
  const wc = repairWindow.webContents;
  wc.on('did-finish-load', () => logLine('[repair-window] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc) => logLine(`[repair-window] did-fail-load code=${code} desc=${desc}`));
  wc.on('preload-error', (e, p, err) => logLine(`[repair-window] preload-error ${err && err.message}`));
  wc.on('console-message', (...args) => {
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    logLine(`[repair-console] ${msg}`);
  });

  repairWindow.loadFile(path.join(__dirname, 'src', 'repair.html'));
  repairWindow.on('closed', () => { repairWindow = null; logLine('[repair-window] closed'); });
}

function openRepairWindow() {
  if (!repairWindow || repairWindow.isDestroyed()) createRepairWindow();
  const show = () => {
    if (!repairWindow || repairWindow.isDestroyed()) return;
    repairWindow.show();
    repairWindow.focus();
    logLine('[repair-window] shown');
  };
  if (repairWindow.webContents.isLoading()) repairWindow.once('ready-to-show', show);
  else show();
}

// "暂不处理" = 收起窗口（不销毁，下次可秒开）
function closeRepairWindow() {
  if (repairWindow && !repairWindow.isDestroyed() && repairWindow.isVisible()) repairWindow.hide();
}

// ===== 阶段 5：今日待办 + 工作统计窗口 =====
// 与补录窗口同样的选型：普通窗口（系统标题栏 + 原生关闭按钮），一个窗口上下两区，
// 托盘的「📋 今日待办」「📊 工作统计」打开的是同一个窗口，只是滚动定位到对应区域。
function createTodoWindow() {
  todoWindow = new BrowserWindow({
    width: 486,
    height: 620,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '今日待办 / 工作统计 · 阿七',
    autoHideMenuBar: true,
    backgroundColor: '#17171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const wc = todoWindow.webContents;
  wc.on('did-finish-load', () => logLine('[todo-window] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc) => logLine(`[todo-window] did-fail-load code=${code} desc=${desc}`));
  wc.on('preload-error', (e, p, err) => logLine(`[todo-window] preload-error ${err && err.message}`));
  wc.on('console-message', (...args) => {
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    logLine(`[todo-console] ${msg}`);
  });

  todoWindow.loadFile(path.join(__dirname, 'src', 'todo.html'));
  todoWindow.on('closed', () => { todoWindow = null; logLine('[todo-window] closed'); });
}

function openTodoWindow(section) {
  if (!todoWindow || todoWindow.isDestroyed()) createTodoWindow();
  const show = () => {
    if (!todoWindow || todoWindow.isDestroyed()) return;
    todoWindow.show();
    todoWindow.focus();
    // 渲染层加载完成后再要求滚动定位，否则监听还没挂上
    try { todoWindow.webContents.send('aqi:todo-focus', section === 'stats' ? 'stats' : 'todo'); } catch (_) {}
    logLine(`[todo-window] shown (${section || 'todo'})`);
  };
  if (todoWindow.webContents.isLoading()) todoWindow.once('ready-to-show', () => setTimeout(show, 120));
  else show();
}

function closeTodoWindow() {
  if (todoWindow && !todoWindow.isDestroyed() && todoWindow.isVisible()) todoWindow.hide();
}

// ===== 阶段 6：阿七健康提醒 =====
// 规格 §29–31：护眼 60 / 久坐 90 / 喝水 120 分钟（连续工作计时）。
// 触发条件三条同时满足：正在工作 + 不在午休 + 提醒开启（§30）。
// 「连续工作分钟」直接取 getStatus().liveMinutes —— 它由区间交集算法算出、午休已被排除。
// 提醒只弹桌宠气泡，不碰 EXP / 等级 / 考勤 / 心情（§31）。
//
// 档位状态只存内存：程序重启后最多对同一档位再提醒一次（无副作用），
// 以此换取「零数据污染」——不往考勤或工作记录里塞提醒状态。
const REMINDER_TICK_MS = 60 * 1000;
let reminderState = rm.zeroState();
let reminderTimer = null;

function resetReminderState(reason) {
  reminderState = rm.zeroState();
  if (reason) logLine('[reminder] state reset (' + reason + ')');
}

function tickReminders() {
  try {
    const root = getAppRoot();
    const st = getStatus(root);

    // 条件 1：正在工作
    if (!st || !st.working) { resetReminderState('not-working'); return; }
    // 条件 2：不在午休（午休期间不触发工作相关提醒）
    if (st.state === 'LUNCH_BREAK') return;

    // 条件 3：提醒功能开启
    const settings = getReminderSettings(root);
    if (!rm.normalizeSettings(settings).enabled) return;

    const r = rm.dueReminders(st.liveMinutes, reminderState, settings);
    reminderState = r.state;
    if (!r.due.length) return;

    const msg = rm.composeMessage(r.due);
    logLine('[reminder] fired ' + r.due.map((d) => `${d.key}@${d.dueAtMin}min`).join(', '));
    // 先让阿七出现在桌面上（气泡依附在它旁边），再弹出气泡。
    // 气泡不会自动消失，需左键单击阿七或气泡才关闭（V-ming 2026-10-05 要求）。
    showWindow();
    showBubble(msg);
  } catch (e) {
    logLine('[reminder] tick failed: ' + (e && e.message));
  }
}

function startReminderTimer() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(tickReminders, REMINDER_TICK_MS);
  logLine(`[reminder] timer started (every ${REMINDER_TICK_MS / 1000}s)`);
}

function remindersEnabled() {
  return rm.normalizeSettings(getReminderSettings(getAppRoot())).enabled;
}

// ===== 阶段 6：提醒气泡（独立小窗，贴在阿七旁边）=====
// V-ming 2026-10-05 要求：提醒显示为阿七旁边的气泡，不在状态卡内；
//   且**不会自动消失**，只有「左键单击阿七」或「左键单击气泡」才消失。
// 选型：做成独立无边框小窗，而不是扩大桌宠主窗口 ——
//   主窗口 180×200 是已验收的布局，扩窗会牵动拖动/点击/卡片，风险大；
//   独立小窗不动主窗口，只需在主窗口移动时同步跟随。
const BUBBLE_W = 216;
const BUBBLE_H = 76;
const BUBBLE_GAP = 6;

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: '阿七提醒',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  bubbleWindow.loadFile(path.join(__dirname, 'src', 'bubble.html'));
  bubbleWindow.on('closed', () => { bubbleWindow = null; logLine('[bubble] closed'); });
  logLine('[bubble] window created');
}

// 依主窗口当前位置计算气泡坐标：默认贴在阿七【上方】，上方空间不够则放下方
function positionBubble() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  let wa = { x: 0, y: 0, width: 1920, height: 1080 };
  try { wa = screen.getDisplayMatching(b).workArea; } catch (_) {}

  let x = Math.round(b.x + b.width / 2 - BUBBLE_W / 2);
  let y = Math.round(b.y - BUBBLE_H - BUBBLE_GAP);
  if (y < wa.y + 4) y = Math.round(b.y + b.height + BUBBLE_GAP);   // 上方放不下 → 放下方
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - BUBBLE_W - 4);
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - BUBBLE_H - 4);
  bubbleWindow.setBounds({ x, y, width: BUBBLE_W, height: BUBBLE_H });
}

function bubbleVisible() {
  return !!(bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible());
}

function showBubble(text) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) createBubbleWindow();
  const paint = () => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
    try { bubbleWindow.webContents.send('aqi:bubble-text', text); } catch (_) {}
    positionBubble();
    bubbleWindow.show();
    if (typeof bubbleWindow.moveTop === 'function') bubbleWindow.moveTop();
    logLine('[bubble] shown: ' + text);
  };
  if (bubbleWindow.webContents.isLoading()) bubbleWindow.once('ready-to-show', () => setTimeout(paint, 60));
  else paint();
}

function hideBubble() {
  if (bubbleVisible()) {
    bubbleWindow.hide();
    logLine('[bubble] hidden');
  }
}

// ===== 阶段 7：互动 + 宠物状态窗口 =====
// 与补录/待办窗口同样的选型：普通窗口（有系统标题栏，能关）。
// 托盘的「❤️ 互动」「🎒 宠物状态」打开的是同一个窗口，只是滚动定位到对应区域。
//
// 宠物状态由 pure 模块 growth.computeState 判定，输入 = 是否工作中 / 气泡是否在显示 / 最近一次互动。
let lastAction = null;        // 'pat' | 'feed' | 'water' | 'play' | 'levelup'
let lastActionAt = null;

function currentPetState() {
  let st = null;
  try { st = getStatus(getAppRoot()); } catch (_) {}
  return growth.computeState({
    working: !!(st && st.working),
    bubbleShown: bubbleVisible(),
    lastAction,
    lastActionAt
  }, new Date());
}

function createGrowthWindow() {
  growthWindow = new BrowserWindow({
    width: 470,
    height: 600,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '互动 / 宠物状态 · 阿七',
    autoHideMenuBar: true,
    backgroundColor: '#17171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const wc = growthWindow.webContents;
  wc.on('did-finish-load', () => logLine('[growth-window] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc) => logLine(`[growth-window] did-fail-load code=${code} desc=${desc}`));
  wc.on('preload-error', (e, p, err) => logLine(`[growth-window] preload-error ${err && err.message}`));
  wc.on('console-message', (...args) => {
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    logLine(`[growth-console] ${msg}`);
  });

  growthWindow.loadFile(path.join(__dirname, 'src', 'growth.html'));
  growthWindow.on('closed', () => { growthWindow = null; logLine('[growth-window] closed'); });
}

function openGrowthWindow(section) {
  if (!growthWindow || growthWindow.isDestroyed()) createGrowthWindow();
  const show = () => {
    if (!growthWindow || growthWindow.isDestroyed()) return;
    growthWindow.show();
    growthWindow.focus();
    try { growthWindow.webContents.send('aqi:growth-focus', section === 'status' ? 'status' : 'interact'); } catch (_) {}
    logLine(`[growth-window] shown (${section || 'interact'})`);
  };
  if (growthWindow.webContents.isLoading()) growthWindow.once('ready-to-show', () => setTimeout(show, 120));
  else show();
}

function closeGrowthWindow() {
  if (growthWindow && !growthWindow.isDestroyed() && growthWindow.isVisible()) growthWindow.hide();
}

// 升级提示：等级提升时用气泡告知（并附带新解锁的道具）
function announceLevelUp(level, newUnlocks) {
  const lines = [growth.levelUpMessage(level)];
  const um = growth.unlockMessage(newUnlocks);
  if (um) lines.push(um);
  lastAction = 'levelup';
  lastActionAt = new Date().toISOString();
  showWindow();
  showBubble(lines.join('\n'));
  // 阶段 8：桌宠本体播一次「升级」动作
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('aqi:level-up'); } catch (_) {}
  }
  pushPetState();
  logLine('[growth] level up -> Lv.' + level + (um ? ' / ' + um : ''));
}

// ===== 阶段 8：点击阿七弹出的功能菜单（规格 §34 + 设计板）=====
// 选型：独立无边框小窗，而不是把桌宠主窗口撑大 ——
//   主窗口 180×200 已验收，扩窗会让透明区域变大、挡住更多桌面操作（规格 §35 明确不许遮挡办公）。
//   菜单做成独立窗后，主窗口只负责"阿七本体 + 动画"，零回归。
// focusable:false —— 菜单不抢焦点，因此点击阿七可反复开关菜单时不会引发失焦抖动。
const MENU_W = 196;
const MENU_H = 344;
const MENU_GAP = 8;

function createMenuWindow() {
  menuWindow = new BrowserWindow({
    width: MENU_W,
    height: MENU_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    title: '阿七菜单',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const wc = menuWindow.webContents;
  wc.on('did-finish-load', () => logLine('[menu] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc) => logLine(`[menu] did-fail-load code=${code} desc=${desc}`));
  wc.on('preload-error', (e, p, err) => logLine(`[menu] preload-error ${err && err.message}`));
  wc.on('console-message', (...args) => {
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    logLine(`[menu-console] ${msg}`);
  });
  menuWindow.loadFile(path.join(__dirname, 'src', 'menu.html'));
  menuWindow.on('closed', () => { menuWindow = null; logLine('[menu] closed'); });
  logLine('[menu] window created');
}

// 依主窗口位置摆放菜单：默认贴阿七【右侧】，右侧空间不足则翻到左侧
function positionMenu() {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  let wa = { x: 0, y: 0, width: 1920, height: 1080 };
  try { wa = screen.getDisplayMatching(b).workArea; } catch (_) {}

  let x = Math.round(b.x + b.width + MENU_GAP);
  let y = Math.round(b.y + b.height / 2 - MENU_H / 2);
  if (x + MENU_W > wa.x + wa.width - 4) x = Math.round(b.x - MENU_W - MENU_GAP);  // 右侧放不下 → 左侧
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - MENU_W - 4);
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - MENU_H - 4);
  menuWindow.setBounds({ x, y, width: MENU_W, height: MENU_H });
}

function menuVisible() {
  return !!(menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible());
}

function showMenu() {
  if (!menuWindow || menuWindow.isDestroyed()) createMenuWindow();
  const paint = () => {
    if (!menuWindow || menuWindow.isDestroyed()) return;
    positionMenu();
    menuWindow.show();                 // focusable:false 的窗口不会抢走焦点
    if (typeof menuWindow.moveTop === 'function') menuWindow.moveTop();
    logLine('[menu] shown');
  };
  if (menuWindow.webContents.isLoading()) menuWindow.once('ready-to-show', () => setTimeout(paint, 60));
  else paint();
}

function hideMenu() {
  if (menuVisible()) {
    menuWindow.hide();
    try { menuWindow.webContents.send('aqi:menu-hidden'); } catch (_) {}
    logLine('[menu] hidden');
  }
}

function toggleMenu() {
  if (menuVisible()) hideMenu();
  else showMenu();
}

// 菜单项 → 对应功能（执行后收起菜单）
function handleMenuAction(act) {
  logLine('[menu] action ' + act);
  hideMenu();
  switch (act) {
    case 'records': openTodayRecord(); break;
    case 'todo': openTodoWindow('todo'); break;
    case 'stats': openTodoWindow('stats'); break;
    case 'growth': openGrowthWindow('interact'); break;
    case 'status': openGrowthWindow('status'); break;
    case 'settings': openSettingsWindow(); break;
    case 'hide': hideWindow(); break;
    default: break;
  }
}

// ===== 阶段 9：设置窗口（规格 §37 开机启动；《开发流程》阶段 9 全部设置项）=====
// 选型同补录/待办/互动：普通窗口（系统标题栏，能关）。
const LOGIN_ITEM_ARGS = ['--aqi-autostart'];

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 470,
    height: 660,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: '设置 · 阿七',
    autoHideMenuBar: true,
    backgroundColor: '#17171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const wc = settingsWindow.webContents;
  wc.on('did-finish-load', () => logLine('[settings-window] did-finish-load'));
  wc.on('did-fail-load', (e, code, desc) => logLine(`[settings-window] did-fail-load code=${code} desc=${desc}`));
  wc.on('preload-error', (e, p, err) => logLine(`[settings-window] preload-error ${err && err.message}`));
  wc.on('console-message', (...args) => {
    const maybe = args[1];
    const msg = (maybe && typeof maybe === 'object') ? maybe.message : args[2];
    logLine(`[settings-console] ${msg}`);
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; logLine('[settings-window] closed'); });
  logLine('[settings-window] created');
}

function openSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
  const show = () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    settingsWindow.show();
    settingsWindow.focus();
    logLine('[settings-window] shown');
  };
  if (settingsWindow.webContents.isLoading()) settingsWindow.once('ready-to-show', show);
  else show();
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) settingsWindow.hide();
}

// 开机启动：开发期（electron.exe .）与打包后（A-Qi.exe）登记方式不同，分别处理。
// 默认值：**开启**（规格 §37「默认建议开启」；V-ming 2026-10-07 确认）。
// 用户可在设置页随时关闭；程序不会把用户的关闭决定改回来（见 syncLoginItem 的判定）。
function applyLoginItem(enabled) {
  const on = !!enabled;
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ITEM_ARGS });
    } else {
      app.setLoginItemSettings({
        openAtLogin: on,
        path: process.execPath,
        args: [path.resolve(__dirname)]
      });
    }
    let real = on;
    try { real = !!app.getLoginItemSettings().openAtLogin; } catch (_) {}
    logLine('[settings] 开机启动 -> ' + real + (app.isPackaged ? ' (packaged)' : ' (dev)'));
    return { ok: true, openAtLogin: real };
  } catch (e) {
    logLine('[settings] setLoginItemSettings failed: ' + (e && e.message));
    return { ok: false, reason: 'io_error', message: e && e.message };
  }
}

function applyAlwaysOnTop(v) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(v !== false);
    logLine('[settings] 置顶 -> ' + (v !== false));
  } catch (e) { logLine('[settings] applyAlwaysOnTop failed: ' + (e && e.message)); }
}

// 启动时把「设置里的意愿」与「系统的真实登记状态」对齐：
//   设置说开、系统没登记 → 登记（首装用户默认开启，规格 §37）
//   设置说关、系统还登记着 → 撤销
// 注：以**设置页**为唯一开关。若在系统"启动项"里手动禁用，下次启动会被设置同步回来；
//    想关请在阿七的设置页里关（这样才会写回 settings.json）。
function syncLoginItem() {
  try {
    const want = !!getSettingsSummary(getAppRoot()).startOnBoot;
    const real = !!app.getLoginItemSettings().openAtLogin;
    if (want !== real) {
      logLine(`[settings] 开机启动状态不同步（设置=${want} 系统=${real}）→ 按设置同步`);
      applyLoginItem(want);
    }
  } catch (_) {}
}

function resetPositionToCenter() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no_window' };
  try {
    const b = mainWindow.getBounds();
    let wa = { x: 0, y: 0, width: 1920, height: 1080 };
    try { wa = screen.getDisplayMatching(b).workArea; } catch (_) {}
    const x = Math.round(wa.x + (wa.width - b.width) / 2);
    const y = Math.round(wa.y + (wa.height - b.height) / 2);
    mainWindow.setPosition(x, y);
    saveMainPosition();
    logLine(`[settings] 位置重置 -> ${x},${y}`);
    return { ok: true, x, y };
  } catch (e) {
    return { ok: false, reason: 'io_error', message: e && e.message };
  }
}

// ===== 阶段 8：宠物状态推送（驱动桌宠的表情与动作切换）=====
// 状态由 growth.computeState 判定（工作中/提醒中/夜间睡眠/互动后…），
// 渲染层把状态映射成"表情 + 姿态"，并把「工作时的随机小动作」交给渲染层做，
// 避免每秒重建 SVG 打断 CSS 动画。
function pushPetState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let st = 'IDLE';
  try { st = currentPetState(); } catch (_) {}
  try { mainWindow.webContents.send('aqi:pet-state', st); } catch (_) {}
}

function startPetStateTimer() {
  if (petStateTimer) clearInterval(petStateTimer);
  petStateTimer = setInterval(pushPetState, 3000);
}

// ===== 阶段 8：桌面位置记忆（规格 §35 + 阶段 9 的"桌面位置"项）=====
// 拖动结束由渲染层通知保存；启动时恢复。显示器分辨率/布局变化时做边界收敛，
// 防止阿七"跑到屏幕外找不回来"。
function applySavedPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const s = readJson(path.join(getAppRoot(), 'data', 'settings.json'), {});
    const p = s && s.position;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    let wa = { x: 0, y: 0, width: 1920, height: 1080 };
    try { wa = screen.getDisplayMatching({ x: p.x, y: p.y, width: 1, height: 1 }).workArea; } catch (_) {}
    const x = Math.min(Math.max(Math.round(p.x), wa.x - 60), wa.x + wa.width - 60);
    const y = Math.min(Math.max(Math.round(p.y), wa.y - 40), wa.y + wa.height - 60);
    mainWindow.setPosition(x, y);
    logLine(`[main] restore position ${x},${y}`);
  } catch (e) { logLine('[main] applySavedPosition failed: ' + (e && e.message)); }
}

function saveMainPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const [x, y] = mainWindow.getPosition();
    updateSettings(getAppRoot(), { position: { x, y } });
    logLine(`[main] save position ${x},${y}`);
  } catch (e) { logLine('[main] saveMainPosition failed: ' + (e && e.message)); }
}

// ===== 托盘菜单 =====
// 顶部为「等级 + 经验条」两行，其后为原有菜单项（显示/隐藏/上工/下工/退出）。
// 说明：Windows 原生菜单只能纯文本，故经验条用方块字符 █/░ 画 5 格近似（长度 = 状态卡经验条的一半）。
function buildTrayTemplate() {
  const li = getLevelInfo(getAppRoot());
  const need = li.expPerLevel || 80;
  const inLv = Math.max(0, Math.min(li.exp || 0, need));
  const bar = wt.expBarText(inLv, need, 5);
  const pending = findPendingRepairs(getAppRoot());   // 阶段 4：待补录天数
  return [
    { label: `🐱 ${li.name} · Lv.${li.level}`, enabled: false },
    { label: `EXP ${bar} ${inLv.toFixed(1)}/${need}`, enabled: false },
    { type: 'separator' },
    // 注：V-ming 2026-10-05 验收决定删除「显示阿七 / 隐藏阿七」两项 ——
    //     左键单击托盘图标即可切换显示/隐藏，功能重复；菜单项太多。
    {
      label: '🟢 上工', click: () => {
        const r = punchIn(getAppRoot());
        logLine(`[tray] 上工 ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
        if (r.ok) resetReminderState('punch-in');   // 阶段 6：新会话，提醒档位归零
        syncTodayRecord();
        setTimeout(refreshTrayMenu, 0);
        showWindow();
        if (mainWindow) mainWindow.webContents.send(
          'aqi:open-card', r.ok ? '上工成功，阿七陪你开工 💪' : '今天已经上工啦'
        );
      }
    },
    {
      label: '🔴 下工', click: () => {
        const r = punchOut(getAppRoot());
        logLine(`[tray] 下工 ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
        if (r.ok) resetReminderState('punch-out');
        syncTodayRecord();
        setTimeout(refreshTrayMenu, 0);
        if (r.ok && r.levelUp) announceLevelUp(r.pet.level, r.newUnlocks);   // 阶段 7
        showWindow();
        if (mainWindow) mainWindow.webContents.send(
          'aqi:open-card', r.ok ? `下工结算 +${r.record.exp.toFixed(1)} EXP` : '还没上工哦'
        );
      }
    },
    { type: 'separator' },
    { label: '📝 今日工作记录', click: () => openTodayRecord() },
    { label: '📁 工作记录（历史）', click: () => openRecordsFolder() },
    { type: 'separator' },
    { label: '📋 今日待办', click: () => openTodoWindow('todo') },
    { label: '📊 工作统计', click: () => openTodoWindow('stats') },
    { type: 'separator' },
    { label: '❤️ 互动', click: () => openGrowthWindow('interact') },
    { label: '🎒 宠物状态', click: () => openGrowthWindow('status') },
    { type: 'separator' },
    {
      label: pending.length ? `🩹 待补录（${pending.length} 天）` : '🩹 补录 / 修正考勤',
      click: () => openRepairWindow()
    },
    { type: 'separator' },
    {
      // 阶段 6：健康提醒开关（设置界面留阶段 9，这里先给一个随时可关的入口）
      type: 'checkbox',
      label: '🔔 健康提醒',
      checked: remindersEnabled(),
      click: (mi) => {
        updateSettings(getAppRoot(), { remindersEnabled: !!mi.checked });
        logLine('[tray] 健康提醒 ' + (mi.checked ? '开启' : '关闭'));
        resetReminderState('toggle');
        setTimeout(refreshTrayMenu, 0);
      }
    },
    { type: 'separator' },
    { label: '⚙ 设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { logLine('[tray] 退出'); app.quit(); } },
    { type: 'separator' },
    // 版本号：放在「退出」下方，灰色淡显（原生菜单只能靠 enabled:false 变灰）
    { label: tf.versionLabel(app.getVersion()), enabled: false }
  ];
}

// 用最新 pet.json 重建托盘菜单 + 刷新悬停提示（上工/下工/补录后调用，保证等级实时）
function refreshTrayMenu() {
  if (!tray) return;
  try {
    const li = getLevelInfo(getAppRoot());
    // 悬停显示【等级】而非版本号（V-ming 2026-10-04）
    tray.setToolTip(tf.tooltip(li));
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate()));
  } catch (e) { logLine('[main] refreshTrayMenu failed: ' + (e && e.message)); }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icons', 'tray-icon.png');
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(img);
  refreshTrayMenu();   // 悬停提示（等级）与菜单一并在此设置
  tray.on('click', () => toggleWindow());
  logLine('[main] tray created');
}

// 显示/隐藏带淡入淡出（阶段 8「隐藏/显示动画」）：
// 淡出由渲染层 CSS 完成，主进程等过渡结束再真正 hide —— 不用窗口透明度 API，避开平台差异。
function showWindow() {
  if (!mainWindow) return;
  try { mainWindow.webContents.send('aqi:window-fade', 'in'); } catch (_) {}
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  if (typeof mainWindow.moveTop === 'function') mainWindow.moveTop();
  mainWindow.focus();
}
function hideWindow() {
  hideMenu();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('aqi:window-fade', 'out'); } catch (_) {}
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  }, 170);
}
function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) hideWindow();
  else showWindow();
}

// ===== IPC：渲染进程控制窗口 =====
ipcMain.on('aqi:toggle-window', () => toggleWindow());
ipcMain.on('aqi:hide-window', () => hideWindow());
// 拖动：渲染层发来光标位移量（屏幕坐标差），主进程移动窗口
ipcMain.on('aqi:drag', (e, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  if (bubbleVisible()) positionBubble();   // 阶段 6：气泡跟随阿七一起移动
  if (menuVisible()) positionMenu();       // 阶段 8：菜单跟随阿七一起移动
});
// 诊断：渲染层日志上报（PM 反馈：不再提供页内 DevTools 入口，日志足够）
ipcMain.on('aqi:log', (e, msg) => logLine(`[renderer] ${msg}`));

// ===== 阶段 2：上工 / 下工 / 状态 查询 =====
ipcMain.handle('aqi:get-status', () => getStatus(getAppRoot()));
ipcMain.handle('aqi:punch-in', () => {
  const r = punchIn(getAppRoot());
  if (r.ok) resetReminderState('punch-in');   // 阶段 6
  refreshTrayMenu();
  syncTodayRecord();
  pushPetState();                             // 阶段 8：桌面阿七立即进入"工作中"
  return r;
});
ipcMain.handle('aqi:punch-out', () => {
  const r = punchOut(getAppRoot());
  if (r.ok) {
    resetReminderState('punch-out');  // 阶段 6
    if (r.levelUp) announceLevelUp(r.pet.level, r.newUnlocks);   // 阶段 7
  }
  refreshTrayMenu();
  syncTodayRecord();
  pushPetState();                             // 阶段 8
  return r;
});

// ===== 阶段 4：补录 / 修正考勤 =====
ipcMain.handle('aqi:get-pending', () => findPendingRepairs(getAppRoot()));

ipcMain.handle('aqi:repair', (e, payload) => {
  const p = payload || {};
  const r = repairAttendance(getAppRoot(), p);
  logLine(`[repair] date=${p.date} ${p.start}→${p.end} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  if (r.ok) {
    syncRecordFor(r.record.date);   // 同步该日 TXT（考勤段会标注"考勤状态：补录"）
    resetReminderState('repair');   // 阶段 6：补录可能改变今日工时，档位重算更安全
    if (r.levelUp) announceLevelUp(r.pet.level, r.newUnlocks);   // 阶段 7
    refreshTrayMenu();
  }
  return r;
});

ipcMain.handle('aqi:ignore-day', (e, date) => {
  const r = ignoreDay(getAppRoot(), date);
  logLine(`[repair] ignore ${date} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  if (r.ok) refreshTrayMenu();
  return r;
});

ipcMain.on('aqi:close-repair', () => closeRepairWindow());

// ===== 阶段 5：今日待办 / 工作统计 =====
ipcMain.handle('aqi:get-todos', () => getTodos(getAppRoot()));
ipcMain.handle('aqi:set-todo', (e, payload) => {
  const p = payload || {};
  const r = setTodoDone(getAppRoot(), p.date, p.index, p.done);
  logLine(`[todo] set date=${p.date} index=${p.index} done=${p.done} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  return r;
});
ipcMain.handle('aqi:get-stats', () => getStats(getAppRoot()));
ipcMain.on('aqi:close-todo', () => closeTodoWindow());

// ===== 阶段 7：成长 / 互动 =====
ipcMain.handle('aqi:get-growth', () => {
  const st = currentPetState();
  return Object.assign({}, getGrowth(getAppRoot()), {
    state: st,
    stateText: growth.stateText(st),
    stateEmoji: growth.stateEmoji(st)
  });
});

ipcMain.handle('aqi:interact', (e, key) => {
  const r = interact(getAppRoot(), key);
  logLine(`[growth] interact ${key} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  if (r.ok) {
    lastAction = key;
    lastActionAt = new Date().toISOString();
    r.state = currentPetState();
    r.stateText = growth.stateText(r.state);
    pushPetState();             // 阶段 8：桌面阿七跟着做反应（吃东西/喝水/开心）
  }
  return r;
});

ipcMain.on('aqi:close-growth', () => closeGrowthWindow());

// ===== 阶段 8：宠物形象 / 点击菜单 / 位置记忆 =====
ipcMain.handle('aqi:get-pet-state', () => {
  try { return currentPetState(); } catch (_) { return 'IDLE'; }
});
ipcMain.on('aqi:toggle-menu', () => toggleMenu());
ipcMain.on('aqi:open-menu', () => showMenu());
ipcMain.on('aqi:close-menu', () => hideMenu());
ipcMain.on('aqi:menu-action', (e, act) => handleMenuAction(act));
ipcMain.on('aqi:save-position', () => saveMainPosition());

// ===== 阶段 9：设置 / 备份恢复 / 位置重置 =====
ipcMain.handle('aqi:get-settings-state', () => {
  const root = getAppRoot();
  const settings = getSettingsSummary(root);
  let loginItem = settings.startOnBoot;
  try { loginItem = !!app.getLoginItemSettings().openAtLogin; } catch (_) {}
  return {
    settings,
    appInfo: getAppInfo(root),
    backups: listBackups(root),
    version: app.getVersion(),
    loginItem
  };
});

ipcMain.handle('aqi:save-settings', (e, patch) => {
  const p = (patch && typeof patch === 'object') ? patch : {};
  const root = getAppRoot();
  updateSettings(root, p);
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  let loginItem = null;
  if (has('alwaysOnTop')) applyAlwaysOnTop(p.alwaysOnTop);
  if (has('startOnBoot')) loginItem = applyLoginItem(p.startOnBoot).openAtLogin;
  // 提醒相关改动 → 档位归零，按新间隔重新计时
  if (has('remindersEnabled') || has('eyeReminderMin') || has('sitReminderMin')) resetReminderState('settings');
  refreshTrayMenu();
  logLine('[settings] saved: ' + Object.keys(p).join(','));
  return { ok: true, settings: getSettingsSummary(root), loginItem };
});

ipcMain.handle('aqi:set-pet-name', (e, name) => {
  const r = setPetName(getAppRoot(), name);
  logLine(`[settings] setPetName "${name}" ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  if (r.ok) { refreshTrayMenu(); pushPetState(); }
  return r;
});

ipcMain.handle('aqi:backup-now', () => {
  const r = backupData(getAppRoot());
  logLine('[settings] backup ' + (r.ok ? r.name : 'FAIL ' + r.reason));
  return r;
});

ipcMain.handle('aqi:restore-backup', (e, name) => {
  const r = restoreBackup(getAppRoot(), name);
  logLine(`[settings] restore ${name} ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
  if (r.ok) {
    recomputeAll(getAppRoot());   // 恢复后全量重算：统计与宠物立即与记录对齐
    resetReminderState('restore');
    refreshTrayMenu();
    syncTodayRecord();
    pushPetState();
  }
  return r;
});

ipcMain.handle('aqi:reset-position', () => resetPositionToCenter());

ipcMain.on('aqi:open-data-dir', () => {
  const dir = path.join(getAppRoot(), 'data');
  logLine('[settings] open data dir ' + dir);
  shell.openPath(dir).then((err) => { if (err) logLine('[settings] open dir failed: ' + err); });
});

ipcMain.on('aqi:close-settings', () => closeSettingsWindow());

// ===== 阶段 6：提醒气泡 =====
ipcMain.on('aqi:hide-bubble', () => hideBubble());
// 点击阿七时先调用：若气泡正显示则关掉它，并返回 true（这一击被气泡用掉）
ipcMain.handle('aqi:dismiss-bubble', () => {
  if (!bubbleVisible()) return false;
  hideBubble();
  return true;
});

// ===== 子进程（含 GPU）异常日志：透明窗口在部分显卡/远程会话下 GPU 进程可能反复崩溃 =====
app.on('child-process-gone', (e, details) => {
  logLine(`[main] child-process-gone type=${details && details.type} reason=${details && details.reason} exitCode=${details && details.exitCode}`);
  if (details && details.type === 'GPU') bumpGpuCrash();
});

// ===== 防止多开 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logLine('[main] 未取得单实例锁 → 退出（系统里已有一个阿七在运行）');
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    logLine('[main] app ready');
    ensureDataLayer(getAppRoot());
    resumeIncomplete(getAppRoot()); // 跨天 working 置 incomplete，防止误算超长工时
    // 阶段 7：启动时全量重算一次 —— 顺带把 unlockedItems 按当前等级补全
    //（老数据的 pet.json 里 unlockedItems 可能是空的，等级却已很高）
    const boot = recomputeAll(getAppRoot());
    if (boot.newUnlocks.length) {
      logLine('[growth] 启动补全解锁：' + boot.newUnlocks.map((u) => u.name).join('、'));
    }
    syncTodayRecord();              // 阶段 3：同步今日工作记录 TXT
    syncIncompleteRecords();        // 阶段 3：补齐跨天未下工那几天的记录
    createWindow();
    // 阶段 9：应用保存的置顶设置（窗口创建时默认置顶，用户可关闭）
    if (getSettingsSummary(getAppRoot()).alwaysOnTop === false) applyAlwaysOnTop(false);
    // 阶段 9：开机启动与设置对齐（默认开启）
    syncLoginItem();
    createTray();
    startReminderTimer();   // 阶段 6：健康提醒定时检查（每 60 秒）
    startPetStateTimer();   // 阶段 8：推送宠物状态（驱动桌宠表情/动作）
    // 阶段 4：第二天提醒 —— 仅当存在待处理异常（忘记上工 / 忘记下工）时才弹出补录窗口。
    // 没有任何异常时不打扰用户；随时也可从托盘「🩹 补录 / 修正考勤」手动打开。
    const pending = findPendingRepairs(getAppRoot());
    if (pending.length) {
      logLine('[main] pending repairs: ' + pending.map(x => x.date + ':' + x.kind).join(', '));
      openRepairWindow();
    }
  });
  // 关闭窗口不退出，托盘常驻
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
}
