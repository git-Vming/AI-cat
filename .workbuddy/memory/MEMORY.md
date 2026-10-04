# 阿七 V1.0 项目长期记忆

## 项目定位
桌面电子宠物「阿七」V1.0 —— Windows 本地桌宠，陪伴工作型。真实工作时长 = 阿七养料。
四条铁律：本地运行、本地存档、无云依赖、可整体迁移。技术路线：Electron + HTML/CSS/JS + JSON/TXT。

## 工作流铁律（V-ming 2026-10-02 确立）
- **分阶段开发，每阶段完成后必须出具《开发报告》，由 V-ming 以 PM 身份人工审核。**
- **V-ming 说"通过/可以继续开发"后，才允许进入下一阶段。未获明确放行前，不得擅自开始下一阶段。**
- 阶段划分见《开发流程》与《开发进度报告.md》：阶段0(已完成) → 阶段1(底座) → 阶段2(上下工/工时/EXP) → 阶段3(工作记录) → 阶段4(遗忘打卡/补录) → 阶段5(待办/统计) → 阶段6(健康提醒) → 阶段7(成长/互动) → 阶段8(完整UI/动画) → 阶段9(设置/开机启动/迁移) → 阶段10(测试/打包)。

## 已确认的关键决策
- 命名/结构以工作空间文档为准：`A-Qi.exe` / 5个JSON(pet,attendance,statistics,settings,tasks) / V1.0 不做 .petpack(留V1.1+)。
- 上下工时间**不写死**：点击即取电脑当前时间；正常一天仅 2 次点击(上工/下工)，午休不点击，由算法自动排除 12:00–14:00。
- 美术素材走 a 方案：优先 MIT/CC0 开源像素猫（阶段1后期/阶段8落地）。
- 目标机：i5-12400F / 16GB / GTX1650 / 466G；Electron 可接受。
- 参考案例：duzexu/desktop-pet = GPL-3.0（只学思路，代码不抄）；Evanfan007/desktop-pet = MIT（可参考结构）。
- **等级规则（V-ming 2026-10-03 定稿）**：**固定 80 EXP 升一级**（Lv.1→Lv.2 需 80 EXP，以此类推）。代码常量 `EXP_PER_LEVEL=80`；文档已同步（《技术实现规格》§19 /《README》§22 已改为 80）。
- **EXP 显示**：全保留 1 位小数、四舍五入（V-ming 2026-10-02）；等级内进度用 `exp`，当日结算所得用 `todayExp`，切勿混用。
- **托盘经验条 = 只能文本近似，别再尝试自绘面板**（2026-10-03 返工教训）：Windows 原生托盘菜单**不能上色、不能画图形条**，故托盘里只能用 `█/░` 方块字符画 5 格近似条（`wt.expBarText(exp,need,5)`）。曾尝试"自绘托盘面板"以实现状态卡那样的绿色条，被 V-ming 以**改动量过大**为由否决并回退。将来若再遇到此需求，先说明该硬限制与代价，不要直接开工。
- **辅助功能窗口用「普通窗口」（带系统标题栏）**，不自绘无边框面板（2026-10-04 定案，阶段4补录窗口）：普通窗口天然可关闭、改动量最小、不存在"关不掉"风险。代价是会在任务栏出现窗口项，可接受。

## 数据架构铁律（阶段4 确立，改动数据前必读）
- **`attendance.json` 是唯一真相来源**；`statistics.json` 与 `pet.json` 一律由 `recomputeAll()` 从它**全量派生**，绝不做增量累加。原因：阶段4 允许"补录/修改历史记录"，增量累加会导致改记录减不掉、重算重复累加。`punchOut` 也走同一条路径。
- 由此推导：`pet.totalExp` 现等于 `statistics.totalExp`。**阶段7 若引入互动/好感度等非工时 EXP，必须为它单开字段**，不得混入 totalExp。
- **红线：跨天未下工绝不能自动算工时**。路径 = `resumeIncomplete` 置 `incomplete` → `recomputeAll` 只统计 `completed` → 必须经 `repairAttendance` 人工确认才变 completed。
- 补录覆盖语义：允许覆盖已有记录（含修改已完成时间）；统计靠全量重算保证正确。但**已有出勤记录的日期禁止被 `ignoreDay` 抹掉**（返回 `has_record`）。
- 记录状态取值：`working | completed | incomplete | absent`；来源：`normal | manual_repair | ignored`。

## 工程约定（踩过的坑，务必遵守）
- 工程目录：`D:\AI-cat\AI-cat\A-Qi\`（Electron 项目源码 + data/ + WorkRecords/ + assets/）。
- 数据根目录：打包后取 exe 同目录；开发期取项目根目录。data/ 与 WorkRecords/ 必须独立于程序代码。
- **渲染层禁用与 contextBridge 暴露名同名的 const/let**：preload 用 `exposeInMainWorld('aqi',…)` 注入的全局 `aqi` 是不可配置属性，`const aqi = window.aqi` 会抛 `SyntaxError: Identifier 'aqi' has already been declared`，**整份脚本不执行**（界面照常显示，极难察觉）。app.js 一律用 `const api = window.aqi`。`node --check` 查不出这类问题，必须跑 `scripts/test-renderer-load.js`。
- **桌宠窗口交互定案**：不用 `-webkit-app-region: drag`（会被 OS 当非客户区、吞掉 mouseup/click，导致"能拖不能点"）；不用整窗 `setIgnoreMouseEvents`。正确做法 = JS 拖动：`pointerdown/pointerup` + `setPointerCapture`，位移用**屏幕坐标 screenX/screenY**（用 clientX 会因窗口移动导致参照系错乱），阈值 6px 区分单击/拖动，`click` 兜底并用确定性标志位去重。
- **诊断**：`A-Qi/diag.log`（主进程/子进程/渲染层上报）是排查渲染层静默失效的唯一可靠手段；不要在桌宠页里加 F12 DevTools 入口（V-ming 明确取消）。
- **窗口尺寸约束**：主窗口 180×200，所有弹出面板必须完整落在窗口内（`overflow:hidden` 会裁切），面板非按钮区域应可点击收起。
