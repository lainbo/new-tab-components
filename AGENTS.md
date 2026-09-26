# new-tab-components

被主项目（新标签页）用 iframe 嵌入的小组件集合。每个组件是一个独立路由（目录），最终以卡片形式呈现在主项目里。

## 硬约束（改代码前必读）

1. **零运行时依赖**。组件被别人的项目加载，依赖越少加载越快。只允许原生 JS/CSS + 浏览器内置 API（`Intl`、Pointer Events 等），不引入任何 npm 运行时包、字体文件、图标库。唯一的 devDependency 是 Vite。
2. **两种目标尺寸**：横向 457×211、正方形 211×211（主力形态）。所有 UI 改动必须在这两种尺寸下都验证，靠 `@container` 查询做分支（阈值 `aspect-ratio < 1.5`）。
3. **不出现原生滚动条**。原生滚动条一律隐藏，滚动位置用自绘 2px 指示器浮层呈现（见下文）。
4. **外层卡片圆角 19px**。内层高亮元素圆角 = 19 − 四周留白。当前留白 10px，故内层圆角固定 9px。改留白时必须同步改圆角，保持这个等式。
5. 换行符 LF；界面语言简体中文。

## 项目结构

```
index.html          # 路由目录页（仅导航链接）
vite.config.js      # 多页构建：新增组件需在 rollupOptions.input 登记
shared/base.css     # 全局 reset + 字体栈（system-ui 非衬线，禁用衬线字体）
currency/           # 汇率组件（目前唯一的路由）
  index.html
  currency.js
  currency.css
```

### 新增一个组件路由

1. 建目录 `<name>/`，放 `index.html` + JS + CSS（参照 currency）
2. `vite.config.js` 的 `rollupOptions.input` 加一行
3. 根 `index.html` 的 `<nav>` 加链接

## 汇率组件（currency/）

### 数据源

- `https://open.er-api.com/v6/latest/USD`，免费、无 key、166 个币种
- **每天只更新一次**（UTC 0 点后），显示的是每日快照而非实时价，与 Wise 等实时中间价差约 0.2% 属正常
- 所有换算以 USD 为桥：`amount / rates[from] * rates[to]`

### 币种元数据（不维护数据表）

166 个币种的中文名、旗帜 emoji 全部运行时生成，见 `getMeta()`：

- 中文名：`Intl.DisplayNames('zh-CN', { type: 'currency' })`，少数简短叫法/非 ISO 代码走 `NAME_OVERRIDES`（美元、人民币、CNH、GGP 等）
- 旗帜：ISO 代码前两位 → 区域指示符 emoji；超国家货币（X 开头）走 `FLAG_OVERRIDES`
- 货币符号曾加过后又移除（长名+大数值币种放不下），不要再加回

### 关键实现决策（踩过的坑）

- **`render()` 只在初始化和币种增减时调用**。输入联动走 `updateOtherValues()` 原地改值，focus 切基准走 `setBaseRow()` 原地改类名。历史 bug：focus 里调 `render()` 重建 DOM 会销毁聚焦中的 input，导致触摸端软键盘弹不出、键盘无法输入。
- **舍入用 `bankersRound()`（四舍六入五成双），禁用 `toFixed`**。`toFixed` 受 IEEE754 影响方向不可预期（`(2.675).toFixed(2) === "2.67"`）。实现用字符串拼十进制指数移位（`"2.675e2"`）避开浮点乘法误差。
- **拖动排序用 Pointer Events**（鼠标/触摸通用），手柄需 `touch-action: none` 防止触摸拖动触发页面滚动。拖到容器上下边缘 28px 内自动滚屏，每帧滚动后要 `startY -= delta` 补偿布局偏移，否则被拖行会飘。被拖行的 `transform` 会撑大 `scrollHeight`，自动滚屏以拖动开始时记下的 `drag.maxScroll` 为上限，否则按住不放会一直滚进空白。
- **行高等分**：行高 = `(100cqh − gap总和) / 行数`，保证可视区恰好整数行（横向 5 行、1:1 六行），不出现半行。`cqh` 基于内容盒，padding 变化自动吸收，但 gap 变化要同步改公式里的扣减值。
- **越界回弹（橡皮筋）**：主列表内容溢出时，滚到头继续滚会把整个 `#app` 用 `translate` 往外推，位移 = `rubberband(越界量)`，即对数阻尼 `16·ln(1 + 0.5·x / 16)`（`RUBBER_SCALE` 16、`RUBBER_RATIO` 0.5）：刚越界时约走一半，之后每多拉出约 11px 所需滚动量翻倍，一直在动但越来越难拉。阻尼尺度用固定像素、不随容器高度缩放：滚轮单次事件的量与卡片大小无关（macOS 滚轮加速、触控板惯性一次就有几百 px），在 211px 高的卡片里按容器高度取尺度会一下拉出半屏。不要改回在列表首尾放真实可滚动留白的做法，那样位移只能线性增长且有固定上限。放得下时不越界（1:1 默认 6 个币种即此情况）。
  - 滚轮监听挂在 `document` 上（`passive: false`）：列表被拉开后指针下方可能是露出的空白，事件落不到 `#app`。滚轮停 `WHEEL_IDLE` 150ms 视为松手，弹回用指数衰减（`RETURN_TAU`），跟随滚轮也做指数平滑（`FOLLOW_TAU`），让鼠标一格一格也连贯。
  - 触控板惯性：滚动量比上一次小的事件（惯性衰减尾巴）只能延续已有越界、不延长松手计时，同一段惯性只顶出一次回弹，否则惯性到头后会撑一两秒不弹回。鼠标每格滚动量相同或更大，不受影响，可以一直往外拉。
  - 触摸：手指直接带动位移。只在 `touchmove` 可取消时接管（手势从边缘开始往外拉），原生滚动已开始的手势交给浏览器。
  - 回弹途中再次越界时用 `rubberbandRaw()`（反函数）从当前位移接着拉，避免跳变。
- **滚动指示器**：原生滚动条隐藏（占布局导致左右间隙不等），`showScrollThumb()` 自绘铺满视口的 SVG fixed 浮层：2px 线条贴卡片右缘，滚动容器贴着卡片上/下边时轨道带同心圆角（半径 = `CARD_RADIUS` 19 − `INDICATOR_INSET` 4）。正常滚动时滑块只在直线段移动；越界时按「位移 / `THUMB_PULL`」绕进圆角并滑出轨道端点，位移达到 `THUMB_PULL`（48px，约 600px 滚动量，正常滚两三下）后保持只剩 `THUMB_TIP` 50px（超过滑块长度时按整个滑块算）；`THUMB_PULL` 要按阻尼曲线的实际位移取值，改了 `RUBBER_SCALE` 要一起看。越界位移是 `#app` 自身的平移，算轨道时要从 `getBoundingClientRect()` 里扣掉；滑块用 `stroke-dasharray/dashoffset` 定位。外层卡片圆角变了要同步改 `CARD_RADIUS`。`pointer-events: none` 纯指示，滚动时淡入、停 800ms 淡出，主列表和管理面板共用（z-index 200 > 面板 100），管理面板没有越界回弹。

### 持久化

- localStorage key `currency-widget-order`，一个数组同时承载「选了哪些币种」和「顺序」
- 恢复时与代码/API 合并：API 已不返回的代码被过滤，存档里没有的新增币种按默认顺序追加到末尾——所以未来增删币种不会破坏用户排序
- iframe 里 localStorage 可能被禁用，所有读写都 try/catch 静默降级

### 交互入口

- 点数字 → 该币种成为基准（行高亮），输入实时重算其他币种
- 拖左侧圆点手柄 → 排序
- **双击列表空白处** → 币种管理面板（搜索 + 点选增删，最少保留 2 个）

## 构建与部署

```bash
pnpm dev      # 本地开发
pnpm build    # 产物在 dist/
wrangler pages deploy ./dist --project-name new-tab-components --branch main
```

- Cloudflare Pages 项目 `new-tab-components`，主域名 https://new-tab-components.pages.dev/currency/
- **手动 CLI 部署**（未绑 Git），改完必须手动 build + deploy
- 部署后验证：`curl -s https://new-tab-components.pages.dev/currency/ | grep -o 'currency-[^"]*\.js'` 对比本地 dist 里的 hash；CDN 缓存可能延迟几秒
