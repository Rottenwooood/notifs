# @notify-hub/web

notify-hub 的管理界面。技术栈：Vite + React + TanStack Query + Tailwind + shadcn/ui（侧边栏模版）。

```sh
pnpm build     # 产物在 dist/，由中心（apps/server）静态托管
pnpm dev       # 本地开发（/api 代理到 127.0.0.1:7710）
```

组件来自 shadcn/ui 官方 registry（`pnpm dlx shadcn@latest add <组件>`），不手写基础样式。
