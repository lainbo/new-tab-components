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
- **拖动排序用 Pointer Events**（鼠标/触摸通用），手柄需 `touch-action: none` 防止触摸拖动触发页面滚动。拖到容器上下边缘 28px 内自动滚屏，每帧滚动后要 `startY -= delta` 补偿布局偏移，否则被拖行会飘。
- **行高等分**：行高 = `(100cqh − gap总和) / 行数`，保证可视区恰好整数行（横向 5 行、1:1 六行），不出现半行。`cqh` 基于内容盒，padding 变化自动吸收，但 gap 变化要同步改公式里的扣减值。
- **回弹留白**：主列表内容溢出时加 `.can-bounce`，首行上方、末行下方各多出 40px 可滚动空白（CSS 伪元素 36px + 4px gap，与 JS 的 `BOUNCE_SPACE` 同步改）。静止位置在内容区内（`scrollTop` ∈ [40, max − 40]），`scrollend` 时若停在留白里就平滑滚回；拖动自动滚屏用 `clampScrollTop()` 限制不进留白。放得下时不加留白（1:1 默认 6 个币种即此情况）。`render()` 不能再用覆盖 `className` 的方式去掉 `is-loading`，否则会丢掉 `.can-bounce` 导致滚动位置跳变。
- **滚动指示器**：原生滚动条隐藏（占布局导致左右间隙不等），`showScrollThumb()` 自绘铺满视口的 SVG fixed 浮层：2px 线条贴卡片右缘，滚动容器贴着卡片上/下边时轨道带同心圆角（半径 = `CARD_RADIUS` 19 − `INDICATOR_INSET` 4）。内容区滚动时滑块只在直线段移动，滚进回弹留白时绕进圆角并滑出轨道端点，滚到留白尽头只剩 `THUMB_TIP` 长的一段（超过滑块长度时按整个滑块算）；滑块用 `stroke-dasharray/dashoffset` 定位。外层卡片圆角变了要同步改 `CARD_RADIUS`。`pointer-events: none` 纯指示，滚动时淡入、停 800ms 淡出，主列表和管理面板共用（z-index 200 > 面板 100），管理面板没有回弹留白。

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
