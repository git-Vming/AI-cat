const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  ensureDataLayer, punchIn, punchOut, getStatus, resumeIncomplete, getLevelInfo,
  readJson, todayStr,
  // 阶段 4
  repairAttendance, ignoreDay, findPendingRepairs,
  // 阶段 5
  getTodos, setTodoDone, getStats
} = require('./src/data-store');
const wt = require('./src/work-time');
const wr = require('./src/work-record');
const tf = require('./src/tray-format');

let mainWindow = null;
let tray = null;
let repairWindow = null;   // 阶段 4：补录 / 修正考勤窗口（普通窗口，非自绘面板）
let todoWindow = null;     // 阶段 5：今日待办 + 工作统计窗口（同样用普通窗口）

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

function createWindow() {
  const root = getAppRoot();
  ensureDataLayer(root); // 阶段 1：初始化 data/ WorkRecords/ backup/ 与默认 JSON
  logLine('[main] createWindow');

  mainWindow = new BrowserWindow({
    width: 180,
    height: 200,
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
    { label: '显示阿七', click: () => showWindow() },
    { label: '隐藏阿七', click: () => hideWindow() },
    { type: 'separator' },
    {
      label: '🟢 上工', click: () => {
        const r = punchIn(getAppRoot());
        logLine(`[tray] 上工 ok=${r.ok}${r.reason ? ' reason=' + r.reason : ''}`);
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
        syncTodayRecord();
        setTimeout(refreshTrayMenu, 0);
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
    {
      label: pending.length ? `🩹 待补录（${pending.length} 天）` : '🩹 补录 / 修正考勤',
      click: () => openRepairWindow()
    },
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

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  if (typeof mainWindow.moveTop === 'function') mainWindow.moveTop();
  mainWindow.focus();
}
function hideWindow() { if (mainWindow) mainWindow.hide(); }
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
});
// 诊断：渲染层日志上报（PM 反馈：不再提供页内 DevTools 入口，日志足够）
ipcMain.on('aqi:log', (e, msg) => logLine(`[renderer] ${msg}`));

// ===== 阶段 2：上工 / 下工 / 状态 查询 =====
ipcMain.handle('aqi:get-status', () => getStatus(getAppRoot()));
ipcMain.handle('aqi:punch-in', () => {
  const r = punchIn(getAppRoot());
  refreshTrayMenu();
  syncTodayRecord();
  return r;
});
ipcMain.handle('aqi:punch-out', () => {
  const r = punchOut(getAppRoot());
  refreshTrayMenu();
  syncTodayRecord();
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

// ===== 子进程（含 GPU）异常日志：透明窗口在部分显卡/远程会话下 GPU 进程可能反复崩溃 =====
app.on('child-process-gone', (e, details) => {
  logLine(`[main] child-process-gone type=${details && details.type} reason=${details && details.reason} exitCode=${details && details.exitCode}`);
  if (details && details.type === 'GPU') bumpGpuCrash();
});

// ===== 防止多开 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    logLine('[main] app ready');
    ensureDataLayer(getAppRoot());
    resumeIncomplete(getAppRoot()); // 跨天 working 置 incomplete，防止误算超长工时
    syncTodayRecord();              // 阶段 3：同步今日工作记录 TXT
    syncIncompleteRecords();        // 阶段 3：补齐跨天未下工那几天的记录
    createWindow();
    createTray();
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
