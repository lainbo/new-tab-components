// 轻量 DOM 工厂：零依赖，供各 widget 拼 UI 结构
export function el(tag, props, ...children) {
  const node = document.createElement(tag)
  if (props) {
    const { class: cls, className, dataset, style, html, text, attrs, ...rest } = props
    if (cls || className) node.className = cls || className
    if (dataset) {
      for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value
    }
    if (style) {
      if (typeof style === 'string') node.style.cssText = style
      else Object.assign(node.style, style)
    }
    if (html !== undefined && html !== null) node.innerHTML = html
    if (text !== undefined && text !== null) node.textContent = text
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined && value !== null) node.setAttribute(key, value)
      }
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined || value === null) continue
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value)
      } else {
        node.setAttribute(key, value)
      }
    }
  }
  appendChildren(node, children)
  return node
}

function appendChildren(parent, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    )
  }
}