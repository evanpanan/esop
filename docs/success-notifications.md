## 统一成功反馈（SuccessToast）

### 组件位置
- 组件：`SuccessToast`
- 文件：[ClientAnimations.tsx](file:///Users/evan/Desktop/esop/src/app/ClientAnimations.tsx)

### 组件能力
- 非阻塞：容器 `pointer-events-none`，仅 toast 卡片可点击
- 动画：淡入淡出 + 轻微位移（`transition-all`）
- 响应式：移动端底部居中；桌面端右上角
- 自动关闭：`durationMs`（默认 4000ms）；也可手动关闭
- 可选后续操作：`actions`（按钮链接）
- 防重复弹出：配合 `clearKeys` 在关闭后清理 URL query

### Props
```ts
SuccessToast({
  toastId: string;
  title: string;
  lines?: string[];
  durationMs?: number;
  clearKeys?: string[];
  actions?: Array<{ label: string; href: string }>;
  closeLabel?: string;
})
```

### Admin 页面接入方式（URL 驱动）
当前实现采用“成功后 redirect + URL query 驱动 toast”的模式：
- server action 成功后 `redirect("/admin?...&ok=...&eid=...")`
- `/admin` 读取 `ok`（以及可选的实体 id），查询摘要信息并渲染 `SuccessToast`
- toast 关闭后自动清理 `ok/eid/gid` 等 query，避免刷新重复显示

已接入的 `ok` 值（见 [admin/page.tsx](file:///Users/evan/Desktop/esop/src/app/admin/page.tsx)）：
- `EMP_CREATED`：员工创建成功（`eid`）
- `GRANT_CREATED`：授予协议创建成功（`gid`）
- `GRANT_SUBMITTED`：协议创建申请已提交（`cr`）

### 在新增“创建类操作”中复用
1) 在 server action 成功分支写入 `ok`（以及必要的摘要定位字段）
```ts
redirect(withOk(returnTo, "SOME_CREATED", { id: created.id }));
```

2) 在对应页面集中做 `ok -> toast` 映射（title/lines/actions/clearKeys）
- title：成功文案（多语言）
- lines：摘要信息（编号/名称/部门等）
- actions：可选“查看详情 / 继续创建”
- clearKeys：至少包含 `ok`，以及你写入的摘要定位字段

### 测试清单（手动）
- 创建员工成功后出现 toast：标题/摘要/按钮正确；3–5 秒自动消失；可手动关闭；关闭后 URL 不再包含 `ok/eid`
- 创建授予协议成功后出现 toast：标题/摘要/按钮正确；关闭后 URL 不再包含 `ok/gid`
- 以 FINANCE 提交授予协议后出现 toast：显示“申请已提交”；不会阻塞继续操作；关闭后仅清理 `ok`（保留 `cr` 以便继续查看申请）
- 弱网/慢请求：仅在 server action 成功落库并 redirect 后显示，不会在失败场景误报
- 多语言：切换 `lang=zh-CN|zh-TW|en` 后 toast 标题/按钮文案随之变化

