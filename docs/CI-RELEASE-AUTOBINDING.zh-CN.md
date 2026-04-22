# CI 发布自动绑定

这份文档说明如何把 `buildId / commitSha / sourceRunIds / sourceLoadRunIds` 从流水线直接提交到 QPilot 的 release 对象里，避免手工去页面补录。

脚本入口：

- [apps/runtime/src/scripts/platform-release-submit.ts](</C:/Users/zjy/QPilot-Studio/apps/runtime/src/scripts/platform-release-submit.ts>)

## 适用场景

适合这几类流水线：

- 功能回归和压测已经分别产出 `runId` / `loadRunId`
- 构建系统已经产出 `buildLabel`、`buildId`、`commitSha`
- 希望在 CI 中直接创建 release，并立刻拿到 gate verdict

## 最常用命令

在仓库根目录执行：

```bash
pnpm release:submit -- \
  --runtime-base-url https://qpilot.example.com \
  --api-token $QPILOT_API_TOKEN \
  --project-id proj_gateway \
  --environment-id env_staging \
  --gate-policy-id gate_default \
  --name "gateway 2026.04.21 candidate" \
  --build-label "gateway-web-2026.04.21.1" \
  --build-id "gateway-web-2190" \
  --commit-sha "7ab12ef" \
  --source-run-id run_core_login_passed \
  --source-load-run-id load_run_gateway_recovery \
  --required-verdict watch \
  --output-file output/release-submit.json
```

## 鉴权方式

公网环境建议使用 tenant-scoped API token，而不是匿名调用。

当前脚本支持：

- `--api-token <token>`
- 或环境变量 `QPILOT_API_TOKEN`

这个 token 至少要有：

- `release:create`
- `gate:read`

建议由 owner 在页面里先创建 API token，再交给 CI secret 管理系统注入。

## 参数说明

核心必填：

- `--project-id`
- `--gate-policy-id`
- `--build-label`

常用可选：

- `--runtime-base-url`
- `--api-token`
- `--environment-id`
- `--name`
- `--build-id`
- `--commit-sha`
- `--source-run-id`
- `--source-load-run-id`
- `--notes`
- `--required-verdict`
- `--output-file`

行为控制：

- `--evaluate`
  创建 release 后立即评估 gate
- `--no-evaluate`
  只创建 release，不做 gate 评估

## 环境变量回退

如果 CI 更习惯通过环境变量注入，脚本会自动读取：

- `QPILOT_RUNTIME_BASE_URL`
- `QPILOT_API_TOKEN`
- `QPILOT_RELEASE_PROJECT_ID`
- `QPILOT_RELEASE_ENVIRONMENT_ID`
- `QPILOT_RELEASE_GATE_POLICY_ID`
- `QPILOT_RELEASE_NAME`
- `QPILOT_RELEASE_BUILD_LABEL`
- `QPILOT_RELEASE_BUILD_ID`
- `QPILOT_RELEASE_COMMIT_SHA`
- `QPILOT_RELEASE_SOURCE_RUN_IDS`
- `QPILOT_RELEASE_SOURCE_LOAD_RUN_IDS`
- `QPILOT_RELEASE_NOTES`
- `QPILOT_RELEASE_REQUIRED_VERDICT`
- `QPILOT_RELEASE_OUTPUT_FILE`
- `QPILOT_RELEASE_EVALUATE`

## 返回结果与退出码

脚本会输出一份 JSON 摘要，包含：

- `release.id`
- `gate.verdict`
- `gate.summary`
- `gate.blockers`
- `requiredVerdict`
- `satisfiedRequiredVerdict`

退出码约定：

- `0`
  成功，且满足要求的 verdict
- `2`
  创建成功，但 gate verdict 没达到 `requiredVerdict`
- `1`
  其他错误，例如鉴权失败、参数缺失、API 返回错误

## 推荐流水线接法

推荐按这个顺序：

1. 功能回归 job 产出最终通过的 `runId`
2. 压测 job 产出用于放行的 `loadRunId`
3. 构建 job 产出 `buildLabel / buildId / commitSha`
4. 发布编排 job 调用 `pnpm release:submit`
5. 把 `output/release-submit.json` 作为后续部署或审批步骤的输入

## 最小验收

上线前至少验这几项：

1. CI 能成功调用脚本
2. QPilot 里能看到新 release
3. Release Detail 页面能看到 `buildId / commitSha / sourceRunIds / sourceLoadRunIds`
4. gate verdict 和 blocker 能正确返回
5. 当 `requiredVerdict=watch` 或 `ship` 不满足时，流水线能正确失败
