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
- **桌宠形象 = SVG 矢量自绘**（2026-10-07 阶段8 定案，`src/pet-svg.js`）：设计板是**原创扁平黑猫**，网上无一致的 MIT/CC0 素材；AI 位图有"表情不一致/体积大/换图不连贯"问题。用参数化 SVG 画 **8 表情 × 7 姿态**，零外部素材依赖、可无限缩放、体积极小。
- **点击阿七的菜单 = 独立无边框小窗**（`src/menu.html`，`focusable: false` 不抢焦点），**不扩大主窗口**：把菜单塞进主窗口会让窗口从 200 涨到 ~540，透明区成倍变大、明显挡住桌面（违反规格 §35）。主窗口只放本体，已验收的拖动/点击/气泡零回归。
- **主进程只推"语义状态"**（复用 `growth.computeState`），表情/姿态映射放渲染层；且**只在状态真正变化时才重建 SVG**，避免每秒重建打断 CSS 动画。
- **隐藏/显示动画用 CSS 过渡**（渲染层淡出 160ms → 主进程延迟 `hide()`），**不用窗口透明度 API**（`transparent:true` 窗口的 `setOpacity` 各平台表现不一）。
- **桌面位置记忆**：`settings.json` 的 `position`。启动恢复到该坐标（做越界收敛，防跑出屏幕）；拖动结束由渲染层通知保存。

## 数据架构铁律（阶段4 确立，改动数据前必读）
- **`attendance.json` 是唯一真相来源**；`statistics.json` 与 `pet.json` 一律由 `recomputeAll()` 从它**全量派生**，绝不做增量累加。原因：阶段4 允许"补录/修改历史记录"，增量累加会导致改记录减不掉、重算重复累加。`punchOut` 也走同一条路径。
- 由此推导：`pet.totalExp` 现等于 `statistics.totalExp`。**阶段7 若引入互动/好感度等非工时 EXP，必须为它单开字段**，不得混入 totalExp。
- **红线：跨天未下工绝不能自动算工时**。路径 = `resumeIncomplete` 置 `incomplete` → `recomputeAll` 只统计 `completed` → 必须经 `repairAttendance` 人工确认才变 completed。
- 补录覆盖语义：允许覆盖已有记录（含修改已完成时间）；统计靠全量重算保证正确。但**已有出勤记录的日期禁止被 `ignoreDay` 抹掉**（返回 `has_record`）。
- 记录状态取值：`working | completed | incomplete | absent`；来源：`normal | manual_repair | ignored`。

## 统计口径（阶段5 确立，改动统计前必读）
- **只统计 `status === 'completed'` 的记录**；`working` / `incomplete` / `absent` 一律不计。
- 维度：今日 / 本周（**周一起算**）/ 本月（**1 日起算**）/ 累计。
- **工作天数 = 该时段有出勤记录的天数（含周六/周日加班日）** —— V-ming 2026-10-05 认可。
- **平均每日工作时长 = 总工作时长 ÷ 工作天数**。
- **连续工作 = 从今天（若今天已下工）或昨天向前回溯，连续有完成记录的天数；任何一天（含周六/周日）没有完成记录即中断**
  —— V-ming 2026-10-05 定稿（原"周末跳过不中断"被修订）。
  例：三/二/一有记录、周日空、周六有记录 → 3 天；日/一/二/三有记录、周六空 → 4 天。
- 实现：`src/stats.js`（纯函数 `computeStats(att, now)` / `computeStreak`）。
- **待办**：来源恒为「前一天」TXT 的【明日待办】（规格§27）；勾选状态只存 `data/tasks.json`，
  **V-ming 2026-10-05 明确决定：不回写 TXT、不带进次日**。实现：`src/todo.js`（解析）+ `src/todo-window.js`（窗口）。

## 健康提醒（阶段6 确立）
- 两种提醒与默认间隔：**护眼 60 / 久坐 90 分钟**（`settings.json` 的 `eyeReminderMin` / `sitReminderMin`）。
  ⚠ **喝水提醒已于 2026-10-05 被 V-ming 取消**，不再实现；旧 settings 里残留的 `waterReminderMin` 会被忽略。
- 触发三条件（规格 §30，必须同时满足）：**正在工作 + 不在午休(12:00–14:00) + `remindersEnabled !== false`**。
- 实现：`src/reminder.js`（纯函数；档位法 `level = floor(liveMinutes / interval)`，同档位不重复提醒，跨多档只报一条但状态推到最新）；`main.js` 每 60 秒 tick 一次。
- **「连续工作分钟」直接用 `getStatus().liveMinutes`** —— 区间交集算法已排除午休，无需另建计时器。
- **提醒呈现 = 阿七旁边的独立气泡小窗**（`src/bubble.html` / `bubble.css` / `bubble-window.js`，216×76 无边框透明）：
  · **不动桌宠主窗口**（180×200 是已验收布局，扩窗回归风险大）；默认贴阿七上方，空间不足自动翻下方；拖动时 `positionBubble()` 跟随。
  · **不自动消失**（无超时）；只有「左键单击气泡 / 左键单击阿七 / Esc」才关。
  · 点击阿七时 `app.js` 的 `handlePetClick()` 先 `dismissBubble()`，返回 true 则这一击只关气泡、不弹卡。
- **提醒不是惩罚（规格 §31）**：提醒链路只写 diag.log + 弹气泡，**绝不写 attendance/statistics/pet**，结构性保证不影响 EXP/等级/考勤/心情。
- 档位状态**只存内存**（程序重启后可能对同一档位再提醒一次，换取零数据污染）。
- 托盘有勾选项「🔔 健康提醒」可随时开关；间隔调整界面留阶段 9。
- **托盘已删除「显示阿七 / 隐藏阿七」**（2026-10-05）：左键单击托盘图标即可切换，不必重复占用菜单项。
- 档位状态**只存内存**（程序重启后可能对同一档位再提醒一次，换取零数据污染）。
- 托盘有勾选项「🔔 健康提醒」可随时开关；间隔调整界面留阶段 9。

## 版本基线与回退（2026-10-04 确立，2026-10-07 最近滚动）
- **每完成一个经 PM 审核通过的阶段 → 建立一份可回退基线**，双保险：
  1. Git 提交 + 打标签。仓库 remote = github.com/git-Vming/AI-cat，**未经 PM 同意不 push**。
  2. 物理快照目录 `D:\AI-cat\AI-cat\_snapshots\<名>_<日期>\`：含 `A-Qi/` 源码 + `文档/` + `校验清单.txt`(sha256) + `快照说明.md`(回退步骤)。
- **快照只冻结「程序」，绝不包含用户数据**：排除 `node_modules/`、`data/*.json`、`WorkRecords/*`、`backup/*`、`diag.log`。回退后阿七仍带全部工作记录与等级。
- **当前 V1.0 测试版（2026-10-07 滚动）= 快照 `_snapshots/V1.0-测试版_20261007/`**（阶段 0–7，61 文件 / 2.1MB / 校验 61/61 OK）。
  Git 标签：`v1.0-beta-3`（阶段 0–6）。历史快照 `V1.0-测试版_20261005`(阶段0-6) / `V1.0-beta-2`(阶段0-5) / `V1.0-beta`(阶段0-4) 已归档到 `_snapshots/_历史版本/`。
- **约定**：`_snapshots/` 下只保留"当前版本"一份非归档快照 + `_历史版本/`；每通过一个阶段就滚动一次。
- 根 `.gitignore` 排除 `_snapshots/`、`node_modules/`、`diag.log`、`_preview/`。
- **【坑】sha256 校验清单不要用 `xargs`**：本机连接器状态注入的环境变量过多 → `xargs: environment is too large for exec`，
  会静默生成**空的**校验清单（`OK=0 FAILED=0`，极难察觉）。改用
  `find … | sort | while IFS= read -r f; do sha256sum "$f" | sed 's|^\./||'; done > 校验清单.txt`。

## 成长与互动（阶段7 确立）
- **核心红线（结构性保证）**：**互动只加好感度，绝不产生 EXP**。`pet.totalExp` 仍只由 `attendance.json` 全量派生；
  `interact()` 只写 `affection` / `interactionCount` / `interactionsToday`，**没有任何修改 totalExp 的路径**。
- 宠物状态（`src/growth.js`）：9 种状态全部定义，**当前可达 7 种** — IDLE / SLEEP / HAPPY / WORKING / EATING / DRINKING / REMINDING；
  判定优先级：气泡显示 > 工作中 > 互动后 12 秒（升级 20 秒）> 夜间(22–6)SLEEP > IDLE。
  **WALK / SAD 暂不触发**（WALK 需动画素材、SAD 规则规格未定义），留阶段 8，**不自行发明规则**。
- 互动动作与每日上限：摸头 5 / 喂食 3 / 喂水 3 / 玩耍 3，每次好感度 +1（跨天归零）。
- 解锁：Lv.2 🎩帽子 → Lv.9 🏆工作奖杯，每级一件；**只增不减**（补录降级不回收）；启动时 `recomputeAll` 自动补全老数据缺失的 `unlockedItems`。
- 升级用**气泡**提示（复用阶段6 气泡，点击才消失）。
- 窗口：`src/growth.html` / `growth.css` / `growth-window.js`（单窗两区：❤️互动 + 🎒宠物状态，普通窗口），托盘两个入口。
- 【测试坑】想造某个等级**不能**手动改 `pet.totalExp` —— `recomputeAll` 会从 attendance 重新派生并覆盖；必须用真实工时记录堆出等级。

## 工程约定（踩过的坑，务必遵守）
- **纯逻辑模块若要被渲染层直接 `<script>` 加载，用 UMD 头**（阶段8 `src/pet-svg.js` 的做法）：
  `if (typeof module!=='undefined'&&module.exports) module.exports=api; if (typeof window!=='undefined') window.PetSvg=api;`
  这样主进程能 `require` 单测、html 能直接加载同一份。**但窗口脚本仍必须单独命名**（`<name>-window.js`），
  绝不把窗口逻辑塞进纯逻辑文件（阶段5 的 `todo.js` 覆盖事故）。
- 工程目录：`D:\AI-cat\AI-cat\A-Qi\`（Electron 项目源码 + data/ + WorkRecords/ + assets/）。
- 数据根目录：打包后取 exe 同目录；开发期取项目根目录。data/ 与 WorkRecords/ 必须独立于程序代码。
- **渲染层禁用与 contextBridge 暴露名同名的 const/let**：preload 用 `exposeInMainWorld('aqi',…)` 注入的全局 `aqi` 是不可配置属性，`const aqi = window.aqi` 会抛 `SyntaxError: Identifier 'aqi' has already been declared`，**整份脚本不执行**（界面照常显示，极难察觉）。一律用 `const api = window.aqi`。`node --check` 查不出这类问题，必须跑 `scripts/test-renderer-load.js` / `test-repair-window.js` / `test-todo-window.js`。
- **「纯逻辑模块」与「窗口脚本」不得同名**（阶段5 踩坑）：一度把 `src/todo.js` 既当被 require 的纯逻辑、又当被 html 加载的窗口脚本，后者覆盖前者 → 主进程报 `window is not defined`。约定：纯逻辑 `src/<name>.js`，窗口脚本 `src/<name>-window.js`（如 `todo-window.js`），并在窗口测试里断言 html 引用的脚本名与实际文件一致。
- **每个新渲染窗口都要三件套**：① 窗口脚本用 `const api = window.aqi`（禁 `aqi`）；② 给它补一份 vm 渲染层测试；③ 窗口用普通窗口（带系统标题栏）而非自绘无边框面板。
- **桌宠窗口交互定案**：不用 `-webkit-app-region: drag`（会被 OS 当非客户区、吞掉 mouseup/click，导致"能拖不能点"）；不用整窗 `setIgnoreMouseEvents`。正确做法 = JS 拖动：`pointerdown/pointerup` + `setPointerCapture`，位移用**屏幕坐标 screenX/screenY**（用 clientX 会因窗口移动导致参照系错乱），阈值 6px 区分单击/拖动，`click` 兜底并用确定性标志位去重。
- **诊断**：`A-Qi/diag.log`（主进程/子进程/渲染层上报）是排查渲染层静默失效的唯一可靠手段；不要在桌宠页里加 F12 DevTools 入口（V-ming 明确取消）。
- **窗口尺寸约束**：主窗口 180×200，所有弹出面板必须完整落在窗口内（`overflow:hidden` 会裁切），面板非按钮区域应可点击收起。
