# KNOWVERSE 云端学习档案实施与激活手册

版本：1.1 · 2026-11-01  
仓库：`liucaidong/knowverse`  
目标：保留 GitHub Pages 与三条产品主线，以 Supabase Free + PostgreSQL + IndexedDB Outbox 提供可选的账户和学习事件同步。

## 当前代码交付边界

本次代码已经包含：

- Supabase Auth GitHub OAuth PKCE 客户端，不依赖前端打包器或第三方 SDK。
- 公开浏览器配置占位文件：`assets/js/backend/public-config.js`。
- IndexedDB 事件镜像、设备 ID、设备内序号、事务性 Outbox、同步游标。
- 学习驾驶舱账户面板、登录回调页面、手动同步和事件追加后的自动同步。
- PostgreSQL Migration：用户白名单、设备、个人事件表、RLS、设备注册和 Push / Pull RPC。
- GitHub Pages 发布白名单：不把 Supabase Migration、测试脚本和后端文档发布到站点。

**重要兼容说明：** 现有挑战、复习和学习进度引擎使用同步式 LocalStorage API。本版本保留其 V1/V2 事件读写契约，并增加 IndexedDB 镜像及 Outbox；LocalStorage 仍是旧引擎的兼容读取源。不能把“已建立 Outbox”误称为已经完成所有进行中挑战快照的 IndexedDB 迁移。挑战与复习进行中状态的云端恢复属于下一阶段。

**云服务尚未自动激活：** GitHub 仓库不能替用户创建 Supabase 项目、注册 GitHub OAuth App 或持有用户的 OAuth Secret。完成下面的人工配置后，学习驾驶舱才会显示云端同步能力。

## 推荐免费架构

| 层 | 技术 | 职责 |
|---|---|---|
| 前端托管 | GitHub Pages | 现有静态页面、课程和三条互动主线 |
| 身份 | Supabase Auth + GitHub OAuth | 单人账户身份 |
| 云数据库 | Supabase PostgreSQL | 用户设备和追加式学习事件 |
| 本地同步队列 | IndexedDB | 事件镜像、Outbox、设备序号、云端游标 |
| 兼容存储 | LocalStorage V1/V2 | 维持当前同步引擎行为，等待后续异步化 |
| 安全 | RLS + 私有 allowlist + RPC | 用户隔离、白名单授权、幂等写入 |
| CI/CD | GitHub Actions | 内容、模块语法、后端契约验证和 Pages 发布 |

免费计划没有生产级 SLA，免费额度、区域和暂停规则可能变化。正式建项时请核对 Supabase 官方定价与地区可用性。零成本目标不等于第三方模型调用、域名或后续文件存储必然免费。

## 一、创建 Supabase 项目

1. 在 Supabase 创建一个项目，优先选择东京附近且当日 Free 套餐可用的区域。
2. 记录 Project URL 与 Publishable Key。
3. 不要将 Secret Key、service_role、数据库密码或 OAuth Client Secret 复制到前端或 Git 仓库。
4. 在项目 SQL Editor 执行 `supabase/migrations/20261101070000_learning_cloud_sync.sql`，或使用 Supabase CLI 应用 Migration。

Supabase CLI 本地流程示例：

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

本仓库不把项目访问令牌或数据库密码写进仓库。若以后启用 CI 自动迁移，应先配置 GitHub Actions Secrets 和受保护环境。

## 二、配置 GitHub OAuth

创建 GitHub OAuth App：

- Homepage URL：`https://liucaidong.github.io/knowverse/`
- Authorization callback URL：`https://<PROJECT_REF>.supabase.co/auth/v1/callback`

在 Supabase Dashboard 的 Authentication → Providers → GitHub 中启用 GitHub Provider，填入 OAuth App 的 Client ID 和 Client Secret。

在 Supabase Authentication → URL Configuration 中设置：

- Site URL：`https://liucaidong.github.io/knowverse/`
- Redirect URLs：`https://liucaidong.github.io/knowverse/auth/callback/`
- 本地开发可另加：`http://localhost:4173/knowverse/auth/callback/`

注意：GitHub OAuth 的 callback 指向 Supabase Auth；Supabase 的允许重定向地址才指向 KNOWVERSE callback 页面。

## 三、启用前端公开配置

编辑 `assets/js/backend/public-config.js`：

```js
window.KNOWVERSE_BACKEND_CONFIG = {
  supabaseUrl: "https://<PROJECT_REF>.supabase.co",
  publishableKey: "<SUPABASE_PUBLISHABLE_KEY>"
};
```

这两个值允许公开，但数据库必须保持 RLS，且不能用 Secret / service_role Key 替代 Publishable Key。提交后 GitHub Pages 自动部署。

未填写配置时系统保持本地模式，不会发起云请求。

## 四、启用单用户白名单

1. 在 KNOWVERSE 学习驾驶舱使用 GitHub 登录一次。
2. 在 Supabase Dashboard → Authentication → Users 找到刚刚创建的 Auth 用户 UUID。
3. 使用 SQL Editor 将该 UUID 加入管理员白名单：

```sql
insert into private.authorized_users(user_id, note)
values ('<AUTH_USER_UUID>', 'KNOWVERSE owner')
on conflict (user_id) do update set enabled = true;
```

白名单不是公开注册表。普通客户端不能读取或修改它。未加入白名单的 OAuth 用户即使登录成功，也不能读写学习事件。

## 五、同步协议

### 本地写入

现有学习引擎先向 LocalStorage V2 追加事件。事件追加成功后，学习驾驶舱监听统一事件通知并写入 IndexedDB：

- `events`：本地事件镜像和同步标记；
- `outbox`：等待云端确认的事件；
- `meta`：安装设备 UUID、严格递增的 device_seq、用户级拉取游标。

LocalStorage 暂时保留为现有引擎的兼容事实源。同步服务启动时会从完整快照重建 Outbox，因此短暂的 IndexedDB 写入中断不会导致本地事件消失。

### 云端 Push

- 每批最多 100 条。
- 服务端从 `auth.uid()` 获取 user_id，不接受客户端指定 user_id。
- 服务端验证账户白名单、设备归属、事件类型、Schema、大小和序号。
- `(user_id,event_id)` 幂等；相同 ID 相同内容视为安全重试，不同内容返回冲突。
- 只有收到服务端确认后才从 Outbox 删除对应条目。

### 云端 Pull

- 按服务端分配的 user_seq 增量分页。
- 本地合并成功后才推进游标。
- Pull 到的云端事件标记为云端来源，不回流到本地 Outbox。
- 掌握度、置信度、gap 和复习队列仍由现有版本化领域算法从事实事件派生，不信任客户端上传的汇总分数。

### 冲突与顺序

当前同步按事件 ID、设备序号和用户序号实现重试及分页。跨设备离线并发的严格因果关系仍需后续 Schema V3 的 causation_event_ids、gap_observation_id 和 target_gap_event_ids 完成。不能仅凭不同设备的时间戳推断先后并静默清除 gap。

## 六、隐私与安全

- 活动事件只保留作品、路由、动作和控件标识，不采集代码编辑器全文、自由文本、表单输入或答案内容。
- 浏览器只能使用 Publishable Key。
- `private.authorized_users` 不暴露给 Data API。
- 学习事件只能通过受控 RPC 追加；普通客户端没有 UPDATE / DELETE 权限。
- 所有公开表启用 RLS，并使用 auth.uid() 限定当前用户。
- 不将用户学习数据写入 Git、静态 JSON、构建产物或公开测试快照。
- GitHub Pages 项目共用用户域名 Origin；必须控制同一 Origin 下的第三方脚本，不能把 OAuth Secret 存在页面。

## 七、验收清单

配置完成后逐项验证：

- [ ] GitHub OAuth 从 Pages 正常跳转并返回 `/auth/callback/`。
- [ ] 白名单用户可注册当前浏览器设备。
- [ ] 未授权账户显示“等待授权”，读取和写入 RPC 均被拒绝。
- [ ] 完成一项挑战后，LocalStorage 事件与 IndexedDB Outbox 均有记录。
- [ ] 手动同步成功后 Outbox 清零，云端 learning_events 数量增加。
- [ ] 重复上传同一事件不会重复插入。
- [ ] 同一 event_id 不同 payload 会报告冲突。
- [ ] 断网完成挑战后，恢复网络并手动同步，事件可补传。
- [ ] 在另一设备登录同一账户后，可以拉取事件并得到相同的本地派生结果。
- [ ] 非白名单用户、匿名用户不能读取其他用户记录。
- [ ] Pages artifact 不包含 supabase Migration、后端测试和 Secret 配置。
- [ ] JSON 导出仍可作为独立备份路径。

## 八、当前未交付的后续阶段

| 阶段 | 后续工作 |
|---|---|
| P1.5 | 将挑战进度和进行中复习 Session 迁移到 IndexedDB；云端快照采用 revision 乐观锁 |
| P2 | 完成事件 Schema V3 因果引用，验证跨设备 gap 生命周期和掌握图谱重放一致性 |
| P3 | AI 服务中心：Edge Function 密钥代理、额度、讲解、推理评估、复习题生成 |
| P4 | 私人学习资料：私有 Storage、文件元数据、签名 URL 和独立对象备份 |

不要把尚未完成的 P1.5 / P2 / AI / Storage 页面显示为已经具备的能力。
