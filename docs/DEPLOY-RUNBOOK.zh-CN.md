# QPilot Studio Deployment Runbook

This runbook matches the current single-host SSH automation in the repo.

It covers:
- first bootstrap
- owner bootstrap
- routine update
- dual-domain smoke
- backup timer checks
- restore verification and auto rollback

## 1. First bootstrap

Prepare:
- one `Ubuntu 24.04 LTS` host
- one SSH user with `sudo`
- DNS for both `app.<domain>` and `www.<domain>`
- a local `runtime.env.production`

Recommended dry run first:

```bash
pnpm deploy:bootstrap -- \
  --host 203.0.113.10 \
  --ssh-user ubuntu \
  --domain app.example.com \
  --public-domain www.example.com \
  --repo-url git@github.com:your-org/QPilot-Studio.git \
  --ref main \
  --cert-email ops@example.com \
  --runtime-env-source C:\deploy\runtime.env.production \
  --dry-run
```

Then run the real bootstrap without `--dry-run`.

## 2. Bootstrap the first owner

Private mode now assumes that web registration is closed.

Create the first owner directly on the server:

```bash
ssh ubuntu@app.example.com
cd /opt/qpilot-studio/app
export AUTH_BOOTSTRAP_OWNER_PASSWORD='<temporary-password>'
pnpm auth:bootstrap-owner -- \
  --email you@example.com \
  --display-name "Your Name" \
  --tenant-name "Private Workspace"
unset AUTH_BOOTSTRAP_OWNER_PASSWORD
```

Rules:
- the database must not contain any users yet
- the email must be present in `AUTH_ALLOWED_EMAILS`
- the command does not create a session
- after success, sign in through `https://app.<domain>/login`

## 3. Routine update

```bash
pnpm deploy:update -- \
  --host 203.0.113.10 \
  --ssh-user ubuntu \
  --ref main \
  --domain app.example.com \
  --public-domain www.example.com \
  --runtime-env-source C:\deploy\runtime.env.production
```

Before updating, the deploy flow records:
- current commit
- current `runtime.env`
- current SQLite snapshot
- rollback metadata

## 4. Dual-domain smoke

```bash
pnpm deploy:smoke -- \
  --base-url https://app.example.com \
  --public-base-url https://www.example.com \
  --metrics-token <METRICS_BEARER_TOKEN> \
  --expect-registration-closed
```

Current smoke rules:
- `GET /health`
- `GET /health/ready`
- `GET /login`
- anonymous private ops API is denied
- anonymous `POST /api/auth/register` returns `403` when private mode is enabled
- `/metrics` without bearer is denied
- `/metrics` with bearer succeeds
- public site home responds
- public site real API stays blocked

## 5. Private mode acceptance

After the first deployment, confirm:
- `www.<domain>` shows the public marketing site
- `app.<domain>` shows the private login page
- no public registration CTA is visible on the private login page
- `POST https://app.<domain>/api/auth/register` returns `403`
- non-allowlisted email login is rejected
- the allowlisted owner email can sign in and open `/platform/ops`

Recommended extra outer guard:
- put `app.<domain>` behind manually configured Cloudflare Access

## 6. Backup timer checks

If backups are configured:

```bash
sudo systemctl is-enabled qpilot-backup.timer
sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value
```

Expected:
- timer enabled
- next trigger timestamp available

If backups are not configured, deploy output should explicitly say the timer is intentionally disabled.

## 7. Restore verification and auto rollback

Restore phases:

```txt
pre_restore_snapshot
-> download
-> decrypt
-> extract
-> swap
-> restart
-> verify
-> rollback (if needed)
-> completed
```

Behavior:
- if restore verification passes, the operation becomes `succeeded`
- if restore verification fails, the system automatically rolls back to the `pre_restore` rescue snapshot
- if rollback verification passes, the restore operation is marked `failed` with `rollbackSucceeded=true`, and maintenance mode is cleared
- if rollback verification fails, maintenance mode stays active and `restore_auto_rollback_failed` is treated as an incident

If `restore_auto_rollback_failed` fires, do not reopen traffic automatically.

## 8. Useful troubleshooting commands

```bash
sudo systemctl status qpilot-runtime
sudo systemctl status qpilot-backup.service
sudo systemctl status qpilot-backup.timer
sudo systemctl status nginx
sudo systemctl status redis-server
sudo journalctl -u qpilot-runtime -n 200 --no-pager
sudo journalctl -u qpilot-backup.service -n 200 --no-pager
sudo nginx -t
```

Key paths:
- runtime service: `/etc/systemd/system/qpilot-runtime.service`
- backup service: `/etc/systemd/system/qpilot-backup.service`
- backup timer: `/etc/systemd/system/qpilot-backup.timer`
- nginx site: `/etc/nginx/sites-available/qpilot.conf`
- runtime env: `/etc/qpilot/runtime.env`
- repo root: `/opt/qpilot-studio/app`
- shared root: `/opt/qpilot-studio/shared`
- ops root: `/opt/qpilot-studio/ops`

## 9. Update rollback

If `deploy:update` fails, the CLI prints:
- previous commit
- env snapshot path
- SQLite snapshot path
- suggested recovery commands

This release does not do fully automatic database rollback. If the failed update already changed the DB, decide manually whether to restore from the saved SQLite snapshot.
