import { el } from '../shared/dom.js'

// 汇率 API：使用免费的 exchangerate-api.com
const API_URL = 'https://open.er-api.com/v6/latest/USD'
const ORDER_KEY = 'currency-widget-order'

// 默认展示的币种（新用户 / 无存档时）
const DEFAULT_CODES = ['USD', 'CNY', 'MOP', 'TRY', 'HKD', 'SGD']
const MIN_CURRENCIES = 2 // 换算至少需要两个币种

// 手写覆盖：保留原有的简短叫法；以及 Intl 不认识的非 ISO 代码
const NAME_OVERRIDES = {
  USD: '美元', CNY: '人民币', MOP: '澳门元', TRY: '土耳其里拉', HKD: '港币', SGD: '新元',
  CNH: '离岸人民币', GGP: '根西镑', IMP: '马恩岛镑', JEP: '泽西镑',
  KID: '基里巴斯元', TVD: '图瓦卢元', FOK: '法罗克朗', XCG: '加勒比盾',
}

// 无法从代码前两位推导国旗的特殊代码（X 开头为超国家货币）
const FLAG_OVERRIDES = {
  ANG: '🇨🇼', XAF: '🌍', XOF: '🌍', XCD: '🌴', XCG: '🌴',
  XPF: '🌺', XDR: '🏦', EUR: '🇪🇺',
}

let rates = {} // 汇率数据（以 USD 为基准）
let selectedCodes = [...DEFAULT_CODES] // 当前展示的币种（含顺序）
let baseCurrency = 'USD' // 当前基准货币
let baseAmount = 1 // 当前基准金额

// ---- 币种元数据：中文名用 Intl 自动生成，旗帜从代码前两位推导 ----
const displayNames = new Intl.DisplayNames(['zh-CN'], { type: 'currency', fallback: 'code' })
const metaCache = new Map()

function getMeta(code) {
  let meta = metaCache.get(code)
  if (meta) return meta

  let name = NAME_OVERRIDES[code]
  if (!name) {
    try { name = displayNames.of(code) } catch { name = code }
  }

  let flag = FLAG_OVERRIDES[code]
  if (!flag) {
    // ISO 货币代码前两位即国家/地区代码，转为区域指示符 emoji
    flag = String.fromCodePoint(...[...code.slice(0, 2)].map(c => 0x1F1A5 + c.charCodeAt(0)))
  }

  meta = { code, name, flag }
  metaCache.set(code, meta)
  return meta
}

// ---- 币种列表持久化（iframe 里 localStorage 可能被禁用，静默降级）----
// 存档同时承载「选了哪些」和「顺序」；恢复时过滤掉 API 已不返回的代码
function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY))
    if (Array.isArray(saved) && saved.length >= MIN_CURRENCIES) {
      selectedCodes = saved
    }
  } catch { /* 忽略 */ }
}

function persistOrder() {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(selectedCodes))
  } catch { /* 忽略 */ }
}

// 获取汇率数据
async function fetchRates() {
  try {
    const res = await fetch(API_URL)
    const data = await res.json()
    if (data.result === 'success') {
      rates = data.rates
      // 剔除 API 已不支持的存档残留
      selectedCodes = selectedCodes.filter(code => code in rates)
      if (selectedCodes.length < MIN_CURRENCIES) selectedCodes = [...DEFAULT_CODES]
      render()
    } else {
      throw new Error('API 返回失败')
    }
  } catch (err) {
    document.getElementById('app').replaceChildren(
      el('div', { class: 'error' }, '无法加载汇率数据'),
    )
  }
}

// 计算目标货币金额
function convert(fromCode, toCode, amount) {
  // 先转换为 USD，再转换为目标货币
  const usdAmount = amount / rates[fromCode]
  return usdAmount * rates[toCode]
}

// 四舍六入五成双（银行家舍入）保留两位小数
// 不用 toFixed：它受二进制浮点表示影响，舍入方向不可预期（如 (1.005).toFixed(2) === "1.00"）
// 通过字符串拼指数（"6.795e2" -> 679.5）做移位，避免乘法引入的浮点误差
function bankersRound(value, decimals = 2) {
  const shifted = Number(`${value}e${decimals}`)
  if (!Number.isFinite(shifted)) return value
  const floor = Math.floor(shifted)
  const diff = shifted - floor
  let result
  if (diff > 0.5) {
    result = floor + 1
  } else if (diff < 0.5) {
    result = floor
  } else {
    // 恰好一半：舍入到相邻的偶数
    result = floor % 2 === 0 ? floor : floor + 1
  }
  return Number(`${result}e-${decimals}`)
}

// 格式化为两位小数的显示文本
function formatAmount(value) {
  return bankersRound(value, 2).toFixed(2)
}

// 拖动手柄图标（两列圆点）
const HANDLE_SVG = `
  <svg viewBox="0 0 10 16" aria-hidden="true">
    <circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/>
    <circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/>
    <circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/>
  </svg>
`

function rowAmount(code) {
  return formatAmount(
    code === baseCurrency ? baseAmount : convert(baseCurrency, code, baseAmount),
  )
}

function buildValueEl(code, { loading = false } = {}) {
  if (loading) {
    return el('span', { class: 'value-skeleton', attrs: { 'aria-hidden': 'true' } })
  }
  return el('input', {
    type: 'text',
    inputmode: 'decimal',
    class: 'currency-value',
    dataset: { code },
    value: rowAmount(code),
  })
}

function buildRow(code, { loading = false } = {}) {
  const currency = getMeta(code)
  const isBase = code === baseCurrency

  return el('div', {
    class: `currency-row${isBase ? ' is-base' : ''}`,
    dataset: { code },
  },
    el('span', { class: 'drag-handle', title: '拖动排序', html: HANDLE_SVG }),
    el('div', { class: 'currency-info' },
      el('span', { class: 'currency-flag' }, currency.flag),
      el('span', { class: 'currency-name' }, currency.name),
      el('span', { class: 'currency-code' }, code),
    ),
    buildValueEl(code, { loading }),
  )
}

// 原地更新已有行：换骨架/输入框、刷新金额与高亮，不重建整行
function patchRow(row, code, { loading = false } = {}) {
  const isBase = code === baseCurrency
  row.classList.toggle('is-base', isBase)

  const slot = row.lastElementChild
  const hasInput = slot?.matches('.currency-value')

  if (loading) {
    if (!slot?.matches('.value-skeleton')) {
      row.replaceChild(buildValueEl(code, { loading: true }), slot)
    }
    return
  }

  if (hasInput) {
    slot.value = rowAmount(code)
    return
  }

  row.replaceChild(buildValueEl(code), slot ?? null)
}

// 按 data-code diff 同步列表：增删行、重排顺序、原地 patch 内容
function syncRows(app, codes, { loading = false } = {}) {
  const existing = new Map(
    [...app.querySelectorAll('.currency-row')].map(row => [row.dataset.code, row]),
  )

  for (const [code, row] of [...existing.entries()]) {
    if (!codes.includes(code)) {
      row.remove()
      existing.delete(code)
    }
  }

  for (const code of codes) {
    if (!existing.has(code)) {
      existing.set(code, buildRow(code, { loading }))
    }
  }

  for (let i = 0; i < codes.length; i++) {
    const row = existing.get(codes[i])
    if (app.children[i] !== row) {
      app.insertBefore(row, app.children[i] ?? null)
    }
    patchRow(row, codes[i], { loading })
  }
}

function buildManagerItem(code) {
  const meta = getMeta(code)
  const added = selectedCodes.includes(code)
  return el('button', {
    class: `manager-item${added ? ' is-added' : ''}`,
    dataset: { code },
  },
    el('span', { class: 'currency-flag' }, meta.flag),
    el('span', { class: 'manager-item-name' }, meta.name),
    el('span', { class: 'manager-item-code' }, code),
    el('span', { class: 'manager-mark' }, added ? '✓' : '+'),
  )
}

// 联网前：先渲染币种列表，数字区显示骨架屏
function renderLoading() {
  const app = document.getElementById('app')
  app.className = 'currency-widget is-loading'
  app.setAttribute('aria-busy', 'true')
  syncRows(app, selectedCodes, { loading: true })
}

// 同步主列表（初始化和币种增减时调用；输入过程中的联动更新走 updateOtherValues，不重建）
function render() {
  const app = document.getElementById('app')
  app.classList.remove('is-loading')
  app.removeAttribute('aria-busy')

  // 仅当基准货币被从列表移除时才回退到首行
  if (!selectedCodes.includes(baseCurrency)) {
    baseCurrency = selectedCodes[0]
    baseAmount = 1
  }

  syncRows(app, selectedCodes)
}

// ---- 越界回弹：主列表滚到头后继续滚，内容按阻尼跟着走、越拉越慢，松手后弹回 ----
const RUBBER_RATIO = 0.5 // 刚越界时位移与滚动量之比，越界越多比例越小
const RUBBER_SCALE = 16 // 阻尼衰减尺度（px）：越小减速越早；越界后每多拉出约 11px（RUBBER_SCALE·ln2），所需滚动量翻一倍
const WHEEL_IDLE = 150 // 滚轮停下多久算松手（ms）
const FOLLOW_TAU = 40 // 位移追赶滚轮目标的时间常数（ms），让鼠标一格一格的滚动也平滑
const RETURN_TAU = 90 // 松手后弹回的时间常数（ms）
let pullRaw = 0 // 越界的原始滚动量：正数为顶部往下拉，负数为底部往上拉
let pullOffset = 0 // 列表当前的实际位移
let pullFrame = null
let pullTime = 0
let wheelTimer = null

// 位移随越界量按对数增长：一直在动，但越往外越难拉
function rubberband(raw) {
  return Math.sign(raw) * RUBBER_SCALE * Math.log1p(RUBBER_RATIO * Math.abs(raw) / RUBBER_SCALE)
}

// rubberband 的反函数：弹回途中再次越界时从当前位移接着拉
function rubberbandRaw(offset) {
  return Math.sign(offset) * RUBBER_SCALE / RUBBER_RATIO * Math.expm1(Math.abs(offset) / RUBBER_SCALE)
}

// delta 为本次滚动量（正数朝顶部方向）；返回 true 表示由越界回弹消耗，调用方需阻止原生滚动
function pullBy(app, delta) {
  const max = app.scrollHeight - app.clientHeight
  if (max <= 0 || drag) return false
  if (!pullRaw) {
    const toTop = delta > 0 && app.scrollTop < 1
    const toBottom = delta < 0 && app.scrollTop > max - 1
    if (!toTop && !toBottom) return false
    pullRaw = rubberbandRaw(pullOffset)
  }
  // 往回滚时最多回到边缘，剩下的交还给原生滚动
  const sign = Math.sign(pullRaw || delta)
  pullRaw = sign * Math.max(sign * (pullRaw + delta), 0)
  return true
}

function applyPull(app) {
  app.style.translate = pullOffset ? `0 ${pullOffset}px` : ''
  showScrollThumb(app, pullOffset)
}

function pullTick(now) {
  const app = document.getElementById('app')
  const target = rubberband(pullRaw)
  const tau = pullRaw ? FOLLOW_TAU : RETURN_TAU
  pullOffset = target + (pullOffset - target) * Math.exp(-Math.max(now - pullTime, 0) / tau)
  pullTime = now
  if (Math.abs(pullOffset - target) < 0.3) pullOffset = target
  applyPull(app)
  pullFrame = pullOffset === target ? null : requestAnimationFrame(pullTick)
}

function animatePull() {
  if (pullFrame !== null) return
  pullTime = performance.now()
  pullFrame = requestAnimationFrame(pullTick)
}

function releasePull() {
  if (!pullRaw) return
  pullRaw = 0
  animatePull()
}

let wheelPrev = { abs: 0, sign: 0, time: 0 }
let inertiaPulled = false // 当前这段衰减的滚轮事件是否已经顶出过一次回弹

// 监听挂在 document 上：列表被拉开后，指针下方可能已是露出的空白，事件不再落到列表上
function onWheel(e) {
  if (managerEl?.classList.contains('is-open')) return
  // 滚动量比上一次小的事件多是触控板惯性的衰减尾巴：只能延续越界、不延长松手计时，
  // 且同一段惯性只顶出一次回弹，否则惯性滚到头后会撑着一两秒不弹回
  const abs = Math.abs(e.deltaY)
  const sign = Math.sign(e.deltaY)
  const fresh = abs >= wheelPrev.abs || sign !== wheelPrev.sign || e.timeStamp - wheelPrev.time > WHEEL_IDLE
  wheelPrev = { abs, sign, time: e.timeStamp }
  if (fresh) inertiaPulled = false
  else if (inertiaPulled && !pullRaw) return

  const starting = !pullRaw
  if (!pullBy(document.getElementById('app'), -e.deltaY)) return
  e.preventDefault()
  if (fresh || starting) {
    clearTimeout(wheelTimer)
    wheelTimer = setTimeout(releasePull, WHEEL_IDLE)
  }
  if (!fresh) inertiaPulled = true
  animatePull()
}

// 触摸：手指直接带动位移，不做平滑；原生滚动已开始时事件不可取消，交给浏览器处理
let touchY = 0

function onTouchMove(e) {
  const y = e.touches[0].clientY
  const delta = y - touchY
  touchY = y
  if (!e.cancelable || !pullBy(e.currentTarget, delta)) return
  e.preventDefault()
  pullOffset = rubberband(pullRaw)
  applyPull(e.currentTarget)
}

// ---- 滚动指示器：贴卡片右缘的 2px 细线，越界时沿圆角继续往上/下跑；滚动时出现、停止后淡出，不占布局空间 ----
const CARD_RADIUS = 19 // 外层卡片圆角
const INDICATOR_INSET = 4 // 指示器中线到卡片边缘的距离，转角半径 = 19 - 4
const THUMB_TIP = 50 // 越界位移达到 THUMB_PULL 后滑块剩下的长度
const THUMB_PULL = 48 // 滑块缩到 THUMB_TIP 所需的越界位移（约 600px 滚动量），拉得更远时保持最短
let indicatorEl = null
let indicatorPath = null

// offset 为滚动容器的越界位移（正数为顶部往下拉）
function showScrollThumb(scrollEl, offset = 0) {
  const { scrollHeight, clientHeight, scrollTop } = scrollEl
  const range = scrollHeight - clientHeight
  if (range <= 0) return

  if (!indicatorEl) {
    const SVG_NS = 'http://www.w3.org/2000/svg'
    indicatorEl = document.createElementNS(SVG_NS, 'svg')
    indicatorEl.classList.add('scroll-indicator')
    indicatorPath = document.createElementNS(SVG_NS, 'path')
    indicatorEl.appendChild(indicatorPath)
    document.body.appendChild(indicatorEl)
  }

  // 轨道：卡片右缘的同心圆角线；滚动容器贴着卡片上/下边时，轨道绕进对应圆角
  // 越界位移是容器自身的平移，要从 rect 里扣掉才是容器原位置
  const rect = scrollEl.getBoundingClientRect()
  const rectTop = rect.top - offset
  const rectBottom = rect.bottom - offset
  const x = innerWidth - INDICATOR_INSET
  const r = CARD_RADIUS - INDICATOR_INSET
  const roundTop = rectTop < CARD_RADIUS
  const roundBottom = innerHeight - rectBottom < CARD_RADIUS
  const top = roundTop ? CARD_RADIUS : rectTop + INDICATOR_INSET
  const bottom = roundBottom ? innerHeight - CARD_RADIUS : rectBottom - INDICATOR_INSET
  const arc = Math.PI * r / 2
  const arcTop = roundTop ? arc : 0
  const arcBottom = roundBottom ? arc : 0
  const straight = bottom - top

  indicatorPath.setAttribute('d', [
    roundTop ? `M${x - r},${INDICATOR_INSET} A${r},${r} 0 0 1 ${x},${top}` : `M${x},${top}`,
    `L${x},${bottom}`,
    roundBottom ? `A${r},${r} 0 0 1 ${x - r},${innerHeight - INDICATOR_INSET}` : '',
  ].join(' '))

  // 滑块长度按内容可视比例算；正常滚动时滑块在直线段内移动，
  // 越界时按位移占 THUMB_PULL 的比例绕过圆角、滑出轨道端点，达到 THUMB_PULL 后只剩 THUMB_TIP 长的一点
  const trackLength = arcTop + straight + arcBottom
  const thumbLength = Math.max(straight * clientHeight / scrollHeight, 16)
  const tip = Math.min(THUMB_TIP, thumbLength) // 剩下的长度最多是整个滑块
  const contentStart = arcTop
  const contentEnd = arcTop + straight - thumbLength
  const progress = Math.min(Math.max(scrollTop / range, 0), 1)
  const pull = Math.min(Math.max(offset / THUMB_PULL, -1), 1)
  const pullTravel = pull > 0 ? contentStart - (tip - thumbLength) : trackLength - tip - contentEnd
  const start = contentStart + (contentEnd - contentStart) * progress - pull * pullTravel
  indicatorPath.style.strokeDasharray = `${thumbLength} ${trackLength}`
  indicatorPath.style.strokeDashoffset = -start

  indicatorEl.classList.add('is-visible')

  clearTimeout(indicatorEl._hideTimer)
  indicatorEl._hideTimer = setTimeout(() => indicatorEl.classList.remove('is-visible'), 800)
}

// 更新基准货币行的高亮样式
function setBaseRow() {
  document.querySelectorAll('.currency-row').forEach(row => {
    row.classList.toggle('is-base', row.dataset.code === baseCurrency)
  })
}

// 处理焦点事件：只更新状态和样式，绝不重建 DOM（否则焦点会丢失、无法输入）
function handleFocus(e) {
  baseCurrency = e.target.dataset.code
  baseAmount = parseFloat(e.target.value) || 0
  setBaseRow()
  const input = e.target
  requestAnimationFrame(() => input.select())
}

// 处理输入事件
function handleInput(e) {
  const value = e.target.value
  // 只允许数字和小数点
  const cleaned = value.replace(/[^\d.]/g, '')
  if (cleaned !== value) {
    e.target.value = cleaned
  }

  const amount = parseFloat(cleaned)
  if (!isNaN(amount) && amount >= 0) {
    baseAmount = amount
    baseCurrency = e.target.dataset.code
    updateOtherValues(e.target)
  }
}

// 实时更新其他货币值（不重新渲染整个页面）
function updateOtherValues(currentInput) {
  document.querySelectorAll('.currency-value').forEach(input => {
    if (input !== currentInput) {
      const targetCode = input.dataset.code
      const amount = convert(baseCurrency, targetCode, baseAmount)
      input.value = formatAmount(amount)
    }
  })
  setBaseRow()
}

// 处理失焦事件
function handleBlur(e) {
  const value = parseFloat(e.target.value)
  if (isNaN(value) || value < 0) {
    e.target.value = '0.00'
    baseAmount = 0
  } else {
    e.target.value = formatAmount(value)
  }
}

// ---- 拖动排序（Pointer Events，鼠标和触摸通用）----
let drag = null
const EDGE_ZONE = 28 // 距容器上下边缘多少像素内触发自动滚动
const MAX_SCROLL_SPEED = 9 // 自动滚动最大速度（px/帧）

function onDragStart(e) {
  if (e.currentTarget.classList.contains('is-loading')) return
  const handle = e.target.closest('.drag-handle')
  if (!handle) return
  e.preventDefault()

  const row = handle.closest('.currency-row')
  const list = row.parentElement
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0

  drag = {
    row,
    list,
    startY: e.clientY,
    lastY: e.clientY,
    step: row.offsetHeight + gap, // 每交换一次位置，布局位移一行的高度
    // 被拖行的 transform 会撑大 scrollHeight，自动滚屏以拖动开始时的可滚动距离为上限，否则会一直滚进空白
    maxScroll: list.scrollHeight - list.clientHeight,
    speed: 0, // 当前自动滚动速度
    raf: null,
  }
  row.classList.add('dragging')
  handle.setPointerCapture(e.pointerId)

  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup', onDragEnd)
  document.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e) {
  if (!drag) return
  drag.lastY = e.clientY
  applyDrag()
  maybeAutoScroll()
}

// 根据当前指针位置更新拖动行的位移，并检查是否需要与相邻行交换
function applyDrag() {
  const { row } = drag
  row.style.transform = `translateY(${drag.lastY - drag.startY}px)`

  const rect = row.getBoundingClientRect()
  const center = rect.top + rect.height / 2

  // 拖过下一行的中线：交换位置，并补偿布局位移让视觉位置连续
  const next = row.nextElementSibling
  if (next) {
    const r = next.getBoundingClientRect()
    if (center > r.top + r.height / 2) {
      next.after(row)
      drag.startY += drag.step
      row.style.transform = `translateY(${drag.lastY - drag.startY}px)`
      return
    }
  }

  // 拖过上一行的中线：同理
  const prev = row.previousElementSibling
  if (prev) {
    const r = prev.getBoundingClientRect()
    if (center < r.top + r.height / 2) {
      prev.before(row)
      drag.startY -= drag.step
      row.style.transform = `translateY(${drag.lastY - drag.startY}px)`
    }
  }
}

// 指针靠近容器上下边缘时启动自动滚动，越靠近边缘速度越快
function maybeAutoScroll() {
  const rect = drag.list.getBoundingClientRect()
  const y = drag.lastY
  let speed = 0
  if (y < rect.top + EDGE_ZONE) {
    speed = -Math.ceil(Math.min(1, (rect.top + EDGE_ZONE - y) / EDGE_ZONE) * MAX_SCROLL_SPEED)
  } else if (y > rect.bottom - EDGE_ZONE) {
    speed = Math.ceil(Math.min(1, (y - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE) * MAX_SCROLL_SPEED)
  }
  drag.speed = speed
  if (speed !== 0 && drag.raf === null) {
    drag.raf = requestAnimationFrame(autoScrollTick)
  }
}

function autoScrollTick() {
  if (!drag || drag.speed === 0) {
    if (drag) drag.raf = null
    return
  }
  const list = drag.list
  const before = list.scrollTop
  list.scrollTop = Math.min(before + drag.speed, drag.maxScroll)
  const delta = list.scrollTop - before

  if (delta === 0) {
    // 已滚到头/滚到底
    drag.speed = 0
    drag.raf = null
    return
  }

  // 容器滚动了 delta，行的布局位置随内容整体偏移，
  // 同步修正 startY 才能让被拖行保持吸附在指针下方
  drag.startY -= delta
  applyDrag()
  showScrollThumb(list)

  drag.raf = requestAnimationFrame(autoScrollTick)
}

function onDragEnd() {
  if (!drag) return
  if (drag.raf !== null) cancelAnimationFrame(drag.raf)
  drag.row.classList.remove('dragging')
  drag.row.style.transform = ''
  drag = null

  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)

  // 从 DOM 读取拖动后的最终顺序
  selectedCodes = [...document.querySelectorAll('.currency-row')].map(row => row.dataset.code)
  persistOrder()
}

// ---- 币种管理面板（双击列表空白处打开）----
let managerEl = null
let managerCountEl = null
let managerSearchEl = null
let managerListEl = null
let managerListOrder = null // 本次打开面板时的固定顺序，操作过程中不重排

function ensureManager() {
  if (managerEl) return

  managerCountEl = el('span', { class: 'manager-count' })
  managerSearchEl = el('input', {
    class: 'manager-search',
    type: 'text',
    placeholder: '搜索代码或名称…',
  })
  managerListEl = el('div', { class: 'manager-list' })

  managerEl = el('div', { class: 'manager' },
    el('div', { class: 'manager-head' },
      el('span', { class: 'manager-title' }, '管理币种'),
      managerCountEl,
      el('button', {
        class: 'manager-close',
        title: '关闭',
        'aria-label': '关闭',
      }, '✕'),
    ),
    managerSearchEl,
    managerListEl,
  )
  document.body.appendChild(managerEl)

  managerEl.querySelector('.manager-close').addEventListener('click', closeManager)
  managerSearchEl.addEventListener('input', renderManagerList)
  managerListEl.addEventListener('click', onManagerToggle)
  managerListEl.addEventListener('scroll', e => showScrollThumb(e.target), { passive: true })
}

// 面板从 display:none 切回 flex 后需等布局完成，scrollTop 才会生效（类似 nextTick）
function resetManagerListScroll() {
  managerListEl.scrollTop = 0
  requestAnimationFrame(() => {
    managerListEl.scrollTop = 0
    requestAnimationFrame(() => {
      managerListEl.scrollTop = 0
    })
  })
}

function openManager() {
  if (!Object.keys(rates).length) return

  ensureManager()
  // 仅在打开时把已选币种排到最前，方便一眼看到；本次会话内顺序不再变动
  const rest = Object.keys(rates).filter(c => !selectedCodes.includes(c)).sort()
  managerListOrder = [...selectedCodes, ...rest]
  managerSearchEl.value = ''
  renderManagerList()
  managerEl.classList.add('is-open')
  resetManagerListScroll()
  managerSearchEl.focus()
}

function closeManager() {
  managerListEl.scrollTop = 0
  managerEl.classList.remove('is-open')
  const active = document.activeElement
  if (active?.matches('.currency-value')) active.blur()
  render() // 同步新列表，保留当前基准货币和金额
}

// 渲染管理面板列表：顺序沿用 managerListOrder（打开时确定），搜索只做过滤
function renderManagerList() {
  const keyword = managerSearchEl.value.trim().toLowerCase()
  const order = managerListOrder ?? []

  const matched = keyword
    ? order.filter(code => {
        const meta = getMeta(code)
        return code.toLowerCase().includes(keyword) || meta.name.toLowerCase().includes(keyword)
      })
    : order

  managerCountEl.textContent = `已选 ${selectedCodes.length}`
  managerListEl.replaceChildren(
    ...(matched.length
      ? matched.map(code => buildManagerItem(code))
      : [el('div', { class: 'manager-empty' }, '无匹配币种')]),
  )
}

function patchManagerItem(item, code) {
  const added = selectedCodes.includes(code)
  item.classList.toggle('is-added', added)
  item.querySelector('.manager-mark').textContent = added ? '✓' : '+'
  managerCountEl.textContent = `已选 ${selectedCodes.length}`
}

function onManagerToggle(e) {
  const item = e.target.closest('.manager-item')
  if (!item) return
  const code = item.dataset.code

  if (selectedCodes.includes(code)) {
    if (selectedCodes.length <= MIN_CURRENCIES) {
      // 至少保留两个币种，闪烁提示
      item.classList.remove('shake')
      void item.offsetWidth // 重启动画
      item.classList.add('shake')
      return
    }
    selectedCodes = selectedCodes.filter(c => c !== code)
  } else {
    selectedCodes = [...selectedCodes, code]
  }
  persistOrder()
  patchManagerItem(item, code)
}

// ---- 初始化 ----
function init() {
  const app = document.getElementById('app')

  // app 级监听只绑定一次（render 会反复重建子节点）
  app.addEventListener('pointerdown', onDragStart)
  app.addEventListener('scroll', () => showScrollThumb(app, pullOffset), { passive: true })
  document.addEventListener('wheel', onWheel, { passive: false })
  app.addEventListener('touchstart', e => { touchY = e.touches[0].clientY }, { passive: true })
  app.addEventListener('touchmove', onTouchMove, { passive: false })
  app.addEventListener('touchend', releasePull)
  app.addEventListener('touchcancel', releasePull)
  app.addEventListener('focusin', e => {
    if (!e.target.matches('.currency-value')) return
    handleFocus(e)
  })
  app.addEventListener('input', e => {
    if (!e.target.matches('.currency-value')) return
    handleInput(e)
  })
  app.addEventListener('focusout', e => {
    if (!e.target.matches('.currency-value')) return
    handleBlur(e)
  })
  app.addEventListener('dblclick', e => {
    // 仅空白处（列表行以外）触发
    if (e.target.closest('.currency-row')) return
    openManager()
  })

  loadOrder()
  renderLoading()
  fetchRates()
}

init()
