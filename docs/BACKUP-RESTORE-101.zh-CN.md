# QPilot Studio 实例级备份与恢复 101

这份文档说明当前单机公网部署形态下的 `shared` 全量备份与恢复方案。当前版本只做实例级备份，不做 tenant 级拆分；目标是保证在误操作、升级异常、磁盘损坏或恢复失败时，平台至少具备一条可审计、可回滚的兜底路径。

## 覆盖范围

- 备份根目录：`BACKUP_SHARED_ROOT`
- 默认部署值：`/opt/qpilot-studio/shared`
- 典型内容：
  - SQLite 数据库
  - `artifacts`
  - `reports`
  - `sessions`
  - `planner-cache`

当前不在 v1 范围内：

- tenant 级恢复
- 浏览器下载备份包
- 站内删除快照
- Redis 状态快照

## 存储与加密

每个快照固定生成三类对象：

- `manifest.json`
- `tar.gz`
- `tar.gz.enc`

上传前会使用 `AES-256-GCM` 做应用层加密，密钥来自：

- `BACKUP_ENCRYPTION_KEY`

S3 侧服务端加密可以继续启用，但不能替代应用层加密。

对象 key 结构固定为：

```txt
<BACKUP_S3_PREFIX>/<yyyy>/<mm>/<snapshotId>/manifest.json
<BACKUP_S3_PREFIX>/<yyyy>/<mm>/<snapshotId>/archive.tar.gz.enc
```

## 必填环境变量

至少准备这些值：

```bash
BACKUP_SHARED_ROOT=/opt/qpilot-studio/shared
BACKUP_OPS_ROOT=/opt/qpilot-studio/ops
BACKUP_S3_ENDPOINT=https://s3.example.com
BACKUP_S3_REGION=us-east-1
BACKUP_S3_BUCKET=qpilot-backups
BACKUP_S3_PREFIX=backups
BACKUP_S3_ACCESS_KEY_ID=<access-key>
BACKUP_S3_SECRET_ACCESS_KEY=<secret-key>
BACKUP_S3_FORCE_PATH_STYLE=false
BACKUP_ENCRYPTION_KEY=<64-char-hex>
BACKUP_RETENTION_DAYS=14
BACKUP_STALE_AFTER_HOURS=36
```

如果缺少 `BACKUP_ENCRYPTION_KEY` 或关键 S3 配置，系统会把备份视为未完成配置：

- UI 显示 `Not configured`
- 手动备份不可执行
- `qpilot-backup.timer` 不会自动启用

## 站内入口

owner 登录后可从两个入口进入：

- `/platform/ops` 顶部 `Open backups`
- `/platform/ops/backups`

页面固定包含：

- `Backup config`
- `Snapshots`
- `Active operation`
- `Restore preflight`
- `Restore history`

当前只支持这些动作：

- `Run backup now`
- `Preview restore`
- `Start restore`
- 查看最近操作状态

## 恢复前检查

恢复前必须先做 preflight，至少检查：

- S3 连通性和目标快照是否存在
- 解密密钥是否可用
- 当前是否有功能运行占用
- 当前 load 队列是否为空
- 磁盘空间是否足够用于下载、解压和 staging
- 快照 schema 是否被当前 runtime 支持

preflight 有两类结果：

- `warning`：可恢复，但建议人工确认
- `failed`：直接阻止恢复

## 恢复执行链路

当前 restore 流程已经升级为明确的阶段机：

```txt
pre_restore_snapshot
-> download
-> decrypt
-> extract
-> swap
-> restart
-> verify
-> rollback (only if verify/apply fails)
-> completed
```

恢复执行顺序固定为：

1. 写入外部 operation journal 与锁文件
2. 创建一份 `pre_restore` 救援快照
3. 进入维护态
4. 下载目标快照
5. 解密并校验归档
6. 解压到 staging
7. 原子替换 `shared`
8. 重启 runtime
9. 运行平台级 smoke 验收

恢复开始后，runtime 会主动进入维护态：

- `/health` 继续返回 `200`
- `/health/ready` 返回 `503`
- 普通业务 API 统一返回 `503 maintenance`
- web 端自动切换到 `/maintenance`

## 平台级恢复验收

恢复是否成功，默认以平台 smoke 为准，而不是只看进程是否起来。

当前 restore 验收与 `deploy:smoke` 共用同一套检查：

- `GET /health` 返回 `200`
- `GET /health/ready` 返回 `200`
- `GET /login` 可访问
- 未登录访问受保护的 ops API 被拒绝
- `GET /metrics` 未带 bearer 被拒绝
- `GET /metrics` 带 bearer 成功
  - 仅在 metrics 已启用且 token 已配置时检查

只有 smoke 全部通过，restore 操作才会标记为 `succeeded`。

## 自动回滚

如果 restore 的应用过程失败，或者 restore 后 smoke 验收失败，系统会立即自动回滚到本次 restore 前刚生成的 `pre_restore` 救援快照。

自动回滚固定行为：

- 最多只执行一次，不递归
- 回滚完成后再次运行同一套平台 smoke
- 回滚 smoke 通过：
  - restore 操作最终记为 `failed`
  - `rollbackSucceeded=true`
  - 退出维护态
- 回滚 smoke 失败：
  - restore 操作记为 `failed`
  - `rollbackSucceeded=false`
  - 保持维护态
  - 触发 critical 告警

站内和 API 中会记录这些字段：

- `phase`
- `phaseUpdatedAt`
- `verification`
- `rollbackSnapshotId`
- `rollbackVerification`
- `rollbackSucceeded`
- `failureReason`

## 维护页

`/maintenance` 现在会实时展示：

- 当前 restore / rollback 阶段
- 最近一次 restore 验收结果
- 最近一次 auto rollback 验收结果
- 当前 operationId / snapshotId / phaseUpdatedAt

如果当前正在自动回滚，页面会明确提示“正在回滚到救援快照”。

## Restore history 结果判定

`/platform/ops/backups` 的 `Restore history` 固定区分三种结果：

- `Restore succeeded`
- `Restore failed, auto rollback succeeded`
- `Restore failed, auto rollback failed`

判定含义：

- 第一种：目标快照恢复成功，平台 smoke 通过
- 第二种：目标快照恢复后平台不可用，但救援快照回滚成功，平台已恢复到之前状态
- 第三种：目标快照恢复失败，救援快照回滚后平台仍未通过 smoke，需要人工介入

## 告警与人工介入

当前与恢复相关的实例级全局告警包括：

- `restore_verification_failed`
- `restore_auto_rollback_failed`

### `restore_verification_failed`

含义：

- restore 已执行完替换与重启，但平台 smoke 未通过
- 系统已经自动进入回滚路径

处理动作：

- 先观察 `/platform/ops/backups` 的 `Active operation`
- 若后续变成 `rollbackSucceeded=true`，说明平台已自动恢复
- 再排查目标快照本身是否存在 schema、数据或产物不一致

### `restore_auto_rollback_failed`

含义：

- restore 验收失败后，自动回滚也未能恢复平台可用性

处理动作：

- 视为维护事故处理
- 不自动放开流量
- 先在主机上检查：
  - `sudo systemctl status qpilot-runtime`
  - `sudo journalctl -u qpilot-runtime -n 200 --no-pager`
  - `sudo journalctl -u qpilot-backup.service -n 200 --no-pager`
- 再根据 `/opt/qpilot-studio/ops/backups/operations/*.json` 判断当前卡在哪个阶段
- 必要时使用最近一次 `pre_restore` 救援快照手动恢复

## 常见备份健康告警

### `backup_not_configured`

含义：

- 生产环境缺少 bucket、访问凭据或 `BACKUP_ENCRYPTION_KEY`

处理：

- 检查 `/etc/qpilot/runtime.env`
- 补齐 `BACKUP_S3_*` 和 `BACKUP_ENCRYPTION_KEY`
- 重新执行 `deploy:update`

### `backup_storage_unreachable`

含义：

- 已配置备份，但 `HeadBucket` 或轻量 list 探针失败

处理：

- 检查 S3 endpoint、region、AK/SK
- 检查主机到对象存储的网络连通性
- 查看 `qpilot-backup.service` 日志

### `backup_snapshot_stale`

含义：

- 最近一次成功备份超过 `BACKUP_STALE_AFTER_HOURS`

处理：

- 检查 `qpilot-backup.timer` 是否启用且存在下一次触发
- 检查 `qpilot-backup.service` 最近一次执行是否失败
- 必要时先手动执行一次 `Run backup now`

### `backup_scheduler_unhealthy`

含义：

- timer 未启用、inactive、failed，或最近一次 service 结果不健康

处理：

- `sudo systemctl status qpilot-backup.timer`
- `sudo systemctl status qpilot-backup.service`
- `sudo systemctl list-timers qpilot-backup.timer`
- `sudo journalctl -u qpilot-backup.service -n 200 --no-pager`

## CLI 与 systemd

运行时脚本内置：

```bash
pnpm --filter @qpilot/runtime run backup:create -- --kind manual
pnpm --filter @qpilot/runtime run backup:restore -- --snapshot-id <snapshotId>
pnpm --filter @qpilot/runtime run backup:prune
```

部署自动化会下发两个 systemd 单元：

- `qpilot-backup.service`
- `qpilot-backup.timer`

默认调度为每日 `03:30` 本地时区。只有同时满足下面条件时，timer 才会自动启用：

- `BACKUP_S3_BUCKET` 已配置
- `BACKUP_ENCRYPTION_KEY` 已配置

常用排查命令：

```bash
sudo systemctl status qpilot-backup.timer
sudo systemctl status qpilot-backup.service
sudo systemctl list-timers qpilot-backup.timer
sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value
sudo journalctl -u qpilot-backup.service -n 200 --no-pager
```

## 运维验收

至少做一次：

1. owner 打开 `/platform/ops/backups`
2. 页面显示配置状态、备份健康摘要和 restore history
3. 执行一次 `Run backup now`
4. 确认新快照出现在 `Snapshots`
5. 对该快照执行 `Preview restore`
6. 确认 preflight 显示通过或明确阻塞项
7. 检查 `qpilot-backup.timer` 是否启用
8. 检查 S3 bucket 中是否出现 `manifest.json` 和 `archive.tar.gz.enc`

## 风险提示

- 恢复会中断当前登录会话和页面状态
- 恢复前必须预留维护窗口
- v1 不做 tenant 级恢复，也不做对象下载
- `manual` 和 `pre_restore` 快照默认不会自动清理
