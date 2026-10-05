const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程只通过此桥与主机通信，不直接 require electron
contextBridge.exposeInMainWorld('aqi', {
  // 托盘/菜单控制
  toggleWindow: () => ipcRenderer.send('aqi:toggle-window'),
  hideWindow: () => ipcRenderer.send('aqi:hide-window'),
  // 拖动窗口：渲染层算出光标位移量（屏幕坐标差），主进程 setPosition 移动窗口
  drag: (dx, dy) => ipcRenderer.send('aqi:drag', dx, dy),
  // 阶段 2：上工 / 下工 / 状态查询
  getStatus: () => ipcRenderer.invoke('aqi:get-status'),
  punchIn: () => ipcRenderer.invoke('aqi:punch-in'),
  punchOut: () => ipcRenderer.invoke('aqi:punch-out'),
  // 主进程（托盘上工/下工）通知渲染层弹出卡片，可附带提示语
  onOpenCard: (cb) => ipcRenderer.on('aqi:open-card', (e, msg) => cb(msg)),
  // 阶段 4：补录 / 修正考勤
  getPending: () => ipcRenderer.invoke('aqi:get-pending'),
  repair: (payload) => ipcRenderer.invoke('aqi:repair', payload),
  ignoreDay: (date) => ipcRenderer.invoke('aqi:ignore-day', date),
  closeRepair: () => ipcRenderer.send('aqi:close-repair'),
  // 阶段 5：今日待办 / 工作统计
  getTodos: () => ipcRenderer.invoke('aqi:get-todos'),
  setTodo: (payload) => ipcRenderer.invoke('aqi:set-todo', payload),
  getStats: () => ipcRenderer.invoke('aqi:get-stats'),
  closeTodo: () => ipcRenderer.send('aqi:close-todo'),
  onFocusSection: (cb) => ipcRenderer.on('aqi:todo-focus', (e, sec) => cb(sec)),
  // 诊断：渲染层日志上报 → 主进程写入 diag.log（PM 反馈：不再提供页内 DevTools 入口）
  log: (msg) => ipcRenderer.send('aqi:log', msg),
  platform: process.platform
});
