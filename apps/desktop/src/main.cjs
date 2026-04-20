const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const webUrl = process.env.QPILOT_DESKTOP_URL || "http://localhost:5173";
const healthUrl = process.env.QPILOT_RUNTIME_HEALTH_URL || "http://localhost:8787/health";

const checkRuntimeHealth = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

const fallbackHtml = `data:text/html;charset=UTF-8,${encodeURIComponent(`
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>QPilot Studio Desktop</title>
      <style>
        body {
          margin: 0;
          font-family: "Segoe UI", Arial, sans-serif;
          background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
          color: #0f172a;
        }
        main {
          max-width: 760px;
          margin: 72px auto;
          padding: 32px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #dbeafe;
          border-radius: 28px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
        }
        h1 { margin: 0 0 12px; font-size: 32px; }
        p { line-height: 1.7; color: #475569; }
        code {
          background: #e2e8f0;
          border-radius: 10px;
          padding: 2px 8px;
        }
        .actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 24px;
        }
        a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 12px 18px;
          border-radius: 999px;
          text-decoration: none;
          font-weight: 600;
        }
        .primary {
          background: #0f172a;
          color: white;
        }
        .secondary {
          border: 1px solid #cbd5e1;
          color: #0f172a;
          background: white;
        }
        .muted {
          margin-top: 12px;
          font-size: 14px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <main>
        <h1>QPilot Studio Desktop</h1>
        <p>
          The desktop shell is ready, but the local runtime has not responded yet.
          Start the full stack with <code>pnpm dev:desktop</code>, or bring the runtime
          service back online and this window will reconnect automatically.
        </p>
        <p id="status" class="muted">Waiting for ${healthUrl} ...</p>
        <div class="actions">
          <a class="primary" href="${webUrl}">Open Web Console</a>
          <a class="secondary" href="${healthUrl}">Open Runtime Health</a>
        </div>
        <script>
          const webUrl = ${JSON.stringify(webUrl)};
          const healthUrl = ${JSON.stringify(healthUrl)};
          const statusEl = document.getElementById("status");

          const poll = async () => {
            try {
              const response = await fetch(healthUrl, { cache: "no-store" });
              if (response.ok) {
                statusEl.textContent = "Runtime is back online. Opening QPilot Studio...";
                window.location.replace(webUrl);
                return;
              }
            } catch (error) {
              void error;
            }

            statusEl.textContent = "Still waiting for the local runtime service...";
            window.setTimeout(poll, 2000);
          };

          window.setTimeout(poll, 1000);
        </script>
      </main>
    </body>
  </html>
`)}`;

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1280,
    minHeight: 760,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    title: "QPilot Studio Desktop",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  if (!(await checkRuntimeHealth())) {
    await win.loadURL(fallbackHtml);
    return;
  }

  try {
    await win.loadURL(webUrl);
  } catch {
    await win.loadURL(fallbackHtml);
  }
};

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error(error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error(error);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
