# QPilot Studio 公网可观测接入 101

这份文档只回答一件事：QPilot 部署到公网之后，怎样做到“活着能看见、不就绪能发现、出了问题能通知”。当前 v1 方案由四部分组成：

- `GET /health`
- `GET /health/ready`
- 受保护的 `/metrics`
- 站内 `/platform/ops` 与通用 webhook 告警

## `/health` 与 `/health/ready` 的区别

### `/health`

- 语义：liveness
- 作用：判断进程是否还活着
- 预期：快速返回 `200`

### `/health/ready`

- 语义：readiness
- 作用：判断服务当前是否适合继续接流量
- 预期：
  - 关键依赖正常时返回 `200`
  - 关键依赖异常时返回 `503`

当前 readiness 会检查：

- SQLite
- `artifacts / reports / sessions / planner-cache`
- Redis
  - 仅当当前部署真的启用 Redis / 分布式队列时才算硬依赖
- Prometheus
  - 只记 warning
- OpenAI key
  - 只记 warning

注意：实例级备份健康不进入 readiness。备份 stale 或 timer 异常会触发 ops 告警，但不会直接把 `/health/ready` 打成失败。

## 恢复期间的探针行为

当实例处于 restore 或 auto rollback 维护窗口时：

- `/health` 继续返回 `200`
- `/health/ready` 返回 `503`
- 普通业务 API 统一返回 `503 maintenance`
- web 端自动进入 `/maintenance`

这能让外部探针和负载均衡明确区分“进程仍活着”和“当前不可接流量”。

## `/metrics` 的使用方式

Prometheus 文本指标地址仍然是：

- `GET /metrics`

生产环境必须配置：

```bash
PLATFORM_METRICS_ENABLED=true
METRICS_BEARER_TOKEN=<long-random-token>
```

请求时带：

```http
Authorization: Bearer <METRICS_BEARER_TOKEN>
```

如果生产环境缺少 `METRICS_BEARER_TOKEN`，runtime 会拒绝暴露 `/metrics`。

## Prometheus 抓取示例

推荐通过受控入口抓取：

```yaml
scrape_configs:
  - job_name: "qpilot-runtime"
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets:
          - qpilot.example.com
    authorization:
      type: Bearer
      credentials: "<METRICS_BEARER_TOKEN>"
```

如果 Prometheus 不方便直接配置 token，也可以通过 Nginx 内部 location 注入 header，但不要把这个入口直接暴露到公网。

## 站内运维页

owner 登录后可访问：

- `/platform/ops`

当前固定展示：

- `Runtime readiness`
- `Backup health`
- `Dependencies`
- `Load queue health`
- `Release risk`
- `Recent alerts`

这个页面只读，不负责在线改配置。

## 备份健康摘要

实例级备份健康已经接入：

- `/api/platform/ops/summary`
- `/api/platform/ops/backups/config`

两处都会返回：

- `backupHealth.state`
- `backupHealth.lastSuccessfulBackupAt`
- `backupHealth.latestSnapshotId`
- `backupHealth.lastFailedOperation`
- `backupHealth.scheduler`
- `backupHealth.checks`

其中 `checks` 固定包含：

- `config`
- `storage`
- `freshness`
- `scheduler`
- `execution`

新增环境变量：

```bash
BACKUP_STALE_AFTER_HOURS=36
```

默认值为 `36` 小时，基于每日 `03:30` 备份设计，允许一次常规调度失败后仍有缓冲窗口。

## 告警规则

当前内置告警包括：

- `runtime_readiness_failed`
- `load_queue_backlog_high`
- `stale_load_worker_detected`
- `new_release_hold_detected`
- `backup_not_configured`
- `backup_storage_unreachable`
- `backup_snapshot_stale`
- `backup_scheduler_unhealthy`
- `restore_verification_failed`
- `restore_auto_rollback_failed`

说明：

- `backup_*` 与 `restore_*` 都是实例级全局告警
- `tenantId=null`
- 告警沿用统一 webhook、cooldown 和 resolved 通知机制

### 触发口径

`backup_not_configured`

- 生产环境缺少 bucket、凭据或 `BACKUP_ENCRYPTION_KEY`

`backup_storage_unreachable`

- 已配置备份，但 `HeadBucket` 或轻量 list 探针失败

`backup_snapshot_stale`

- 最近一次成功备份超过 `BACKUP_STALE_AFTER_HOURS`

`backup_scheduler_unhealthy`

- timer 未启用、inactive、failed，或 service 最近一次结果不健康

`restore_verification_failed`

- restore 应用后平台 smoke 未通过，系统已进入 auto rollback 路径

`restore_auto_rollback_failed`

- restore 验收失败后，auto rollback 也未能通过平台 smoke

## Webhook payload 示例

QPilot 会向 `OPS_ALERT_WEBHOOK_URL` 发送 JSON：

```json
{
  "event": "triggered",
  "deliveredAt": "2026-04-21T10:20:30.000Z",
  "alert": {
    "id": "ops-alert-123",
    "tenantId": null,
    "ruleKey": "backup_snapshot_stale",
    "severity": "critical",
    "status": "active",
    "summary": "Latest successful backup is older than the configured freshness window.",
    "detail": {
      "staleAfterHours": 36,
      "lastSuccessfulBackupAt": "2026-04-19T03:30:00.000Z"
    },
    "fingerprint": "backup_snapshot_stale:instance",
    "firstTriggeredAt": "2026-04-21T10:00:00.000Z",
    "lastTriggeredAt": "2026-04-21T10:20:30.000Z",
    "lastDeliveredAt": "2026-04-21T10:20:30.000Z"
  }
}
```

恢复时：

- `event` 变为 `resolved`
- `alert.status` 变为 `resolved`

## Nginx 建议

不要把 `/metrics` 直接裸露到公网。建议：

- `/health` 与 `/health/ready` 保留给探针或负载均衡
- `/metrics` 只给 Prometheus 或受控内网入口
- `/api/` 正常反代到 runtime

## systemd / 部署后验收清单

建议上线后逐项核对：

1. `curl http://127.0.0.1:8787/health`
2. `curl http://127.0.0.1:8787/health/ready`
3. `curl -H "Authorization: Bearer <token>" http://127.0.0.1:8787/metrics`
4. owner 登录后打开 `/platform/ops`
5. 确认 `Backup health` 区块存在
6. 如果已配置备份，确认 `/platform/ops/backups` 能显示 freshness、scheduler、storage、last failure
7. 人工制造一个可预期的告警场景
8. 确认 webhook 收到 `triggered`
9. 条件恢复后确认 webhook 收到 `resolved`

## 常用排查命令

```bash
sudo systemctl status qpilot-runtime
sudo systemctl status qpilot-backup.timer
sudo systemctl status qpilot-backup.service
sudo systemctl list-timers qpilot-backup.timer
sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value
sudo journalctl -u qpilot-backup.service -n 200 --no-pager
```

## 当前没做的事项

这份方案暂时不覆盖：

- 备份在线配置 UI
- 快照在线删除
- ELK / Loki / OpenTelemetry 日志体系
- 多节点高可用
- 告警配置中心 UI
