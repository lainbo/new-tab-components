# new-tab-components

新标签页小组件集合，供主项目通过 iframe 嵌入，每个组件是一个独立路由，以卡片形式呈现。

在线预览：https://new-tab-components.pages.dev

## 组件

- **汇率换算**（`/currency/`）：166 个币种实时换算、拖动排序、双击管理币种，数据来自 [open.er-api.com](https://open.er-api.com)（每日更新）

## 特点

- 零运行时依赖，纯原生 JS/CSS，唯一 devDependency 是 Vite
- 适配横向（457×211）和正方形（211×211）两种卡片尺寸

## 开发

```bash
pnpm install
pnpm dev      # 本地开发
pnpm build    # 构建到 dist/
```

## 部署

```bash
wrangler pages deploy ./dist --project-name new-tab-components --branch main
```
