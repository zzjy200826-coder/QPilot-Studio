import { createServer } from "node:http";

export interface ManagedFixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

const greenhouseHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Greenhouse Fixture</title>
  </head>
  <body>
    <main id="mount"></main>
    <script>
      const mount = document.getElementById("mount");
      let step = 1;
      const render = () => {
        if (step === 1) {
          mount.innerHTML = \`
            <form id="greenhouse-step-1">
              <label>First name <input name="first_name" /></label>
              <label>Email <input type="email" name="email" /></label>
              <label>Resume / CV <input type="file" name="resume" /></label>
              <label>Desired compensation <input name="salary" /></label>
              <button type="button" id="continue-greenhouse">Continue</button>
            </form>
          \`;
          document.getElementById("continue-greenhouse").addEventListener("click", () => {
            step = 2;
            render();
          });
          return;
        }

        mount.innerHTML = \`
          <form id="greenhouse-step-2">
            <label>LinkedIn profile <input name="linkedin" /></label>
            <button type="submit">Submit application</button>
          </form>
        \`;
        document.getElementById("greenhouse-step-2").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "<p>Thank you for applying</p>";
        });
      };

      render();
    </script>
  </body>
</html>`;

const feishuSheetHtml = (port: number) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>飞书岗位表夹具</title>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>公司</th>
          <th>批次</th>
          <th>投递链接</th>
          <th>内推码</th>
          <th>投递详情</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>FixtureCo Auto</td>
          <td>春招</td>
          <td>
            <a href="http://127.0.0.1:${port}/apply/greenhouse/automation-platform">官网投递链接</a>
          </td>
          <td>内推码：AUTO123</td>
          <td>支持直接自动投递的 Greenhouse hosted apply 页面</td>
        </tr>
        <tr>
          <td>Campus Portal Co</td>
          <td>春招</td>
          <td>
            <a href="https://jobs.example.com/campus?code=PORTAL888">校园招聘入口</a>
          </td>
          <td>内推码：PORTAL888</td>
          <td>这是普通岗位入口链接，不是 hosted apply 页面</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

const greenhouseAutoApplyHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Greenhouse Auto Apply Fixture</title>
  </head>
  <body>
    <main id="mount"></main>
    <script>
      const mount = document.getElementById("mount");
      let step = 1;
      const render = () => {
        if (step === 1) {
          mount.innerHTML = \`
            <form id="greenhouse-auto-step-1">
              <label>First name <input name="first_name" /></label>
              <label>Email <input type="email" name="email" /></label>
              <label>Resume / CV <input type="file" name="resume" /></label>
              <button type="button" id="continue-greenhouse-auto">Continue</button>
            </form>
          \`;
          document.getElementById("continue-greenhouse-auto").addEventListener("click", () => {
            step = 2;
            render();
          });
          return;
        }

        mount.innerHTML = \`
          <form id="greenhouse-auto-step-2">
            <label>LinkedIn profile <input name="linkedin" /></label>
            <button type="submit">Submit application</button>
          </form>
        \`;
        document
          .getElementById("greenhouse-auto-step-2")
          .addEventListener("submit", (event) => {
            event.preventDefault();
            document.body.innerHTML = "<p>Thank you for applying</p>";
          });
      };

      render();
    </script>
  </body>
</html>`;

const leverHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Lever Fixture</title>
  </head>
  <body>
    <main id="mount"></main>
    <script>
      const mount = document.getElementById("mount");
      const phaseKey = "lever-fixture-phase";
      const enteredAtKey = "lever-fixture-entered-at";
      const resolveStep = () => {
        const phase = window.localStorage.getItem(phaseKey);
        const enteredAt = Number(window.localStorage.getItem(enteredAtKey) || "0");
        if (phase === "verification") {
          if (Date.now() - enteredAt > 1200) {
            return 3;
          }
          return 2;
        }
        if (phase === "ready") {
          return 3;
        }
        return 1;
      };
      const render = () => {
        const step = resolveStep();
        if (step === 1) {
          mount.innerHTML = \`
            <form id="lever-step-1">
              <label>First name <input name="firstName" /></label>
              <label>Email <input type="email" name="email" /></label>
              <label>Resume <input type="file" name="resume" /></label>
              <button type="button" id="continue-lever">Continue</button>
            </form>
          \`;
          document.getElementById("continue-lever").addEventListener("click", () => {
            window.localStorage.setItem(phaseKey, "verification");
            window.localStorage.setItem(enteredAtKey, String(Date.now()));
            render();
          });
          return;
        }

        if (step === 2) {
          mount.innerHTML = "<p>Email verification required before you can continue.</p>";
          window.setTimeout(render, 250);
          return;
        }

        window.localStorage.setItem(phaseKey, "ready");
        mount.innerHTML = \`
          <form id="lever-step-3">
            <p>Manual check cleared. Review and submit.</p>
            <button type="submit">Submit application</button>
          </form>
        \`;
        document.getElementById("lever-step-3").addEventListener("submit", (event) => {
          event.preventDefault();
          document.body.innerHTML = "<p>Application submitted</p>";
        });
      };

      render();
    </script>
  </body>
</html>`;

const sendJson = (response: import("node:http").ServerResponse, body: unknown): void => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
};

const sendHtml = (response: import("node:http").ServerResponse, body: string): void => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
};

export const startFixtureServer = async (port: number): Promise<ManagedFixtureServer> => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (requestUrl.pathname === "/greenhouse/v1/boards/fixtureco/jobs") {
      sendJson(response, {
        jobs: [
          {
            id: 101,
            title: "Research Engineer",
            absolute_url: `http://127.0.0.1:${port}/apply/greenhouse/research-engineer`,
            content: "<p>Build reliable local-first application flows.</p>",
            location: {
              name: "Remote"
            },
            updated_at: "2026-04-18T00:00:00.000Z"
          },
          {
            id: 102,
            title: "Automation Platform Engineer",
            absolute_url: `http://127.0.0.1:${port}/apply/greenhouse/automation-platform`,
            content: "<p>Own safe end-to-end application automation.</p>",
            location: {
              name: "Remote"
            },
            updated_at: "2026-04-18T12:00:00.000Z"
          }
        ]
      });
      return;
    }

    if (requestUrl.pathname === "/feishu/sheet") {
      sendHtml(response, feishuSheetHtml(port));
      return;
    }

    if (requestUrl.pathname === "/lever/v0/postings/fixtureco") {
      const skip = Number(requestUrl.searchParams.get("skip") ?? "0");
      if (skip > 0) {
        sendJson(response, []);
        return;
      }

      sendJson(response, [
        {
          id: "lever-fixture-1",
          text: "Platform Operations Engineer",
          hostedUrl: `http://127.0.0.1:${port}/apply/lever/platform-ops`,
          applyUrl: `http://127.0.0.1:${port}/apply/lever/platform-ops`,
          categories: {
            location: "Remote",
            commitment: "Full-time",
            team: "Platform"
          },
          descriptionPlain: "Own stable browser-side application automation.",
          additionalPlain: "Manual verification can pause and resume.",
          createdAt: Date.parse("2026-04-18T00:00:00.000Z")
        }
      ]);
      return;
    }

    if (requestUrl.pathname === "/apply/greenhouse/research-engineer") {
      sendHtml(response, greenhouseHtml());
      return;
    }

    if (requestUrl.pathname === "/apply/greenhouse/automation-platform") {
      sendHtml(response, greenhouseAutoApplyHtml());
      return;
    }

    if (requestUrl.pathname === "/apply/lever/platform-ops") {
      sendHtml(response, leverHtml());
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  });

  await new Promise<void>((resolveListen) => {
    server.listen(port, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the fixture server port.");
  }
  const activePort = address.port;

  return {
    baseUrl: `http://127.0.0.1:${activePort}`,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    }
  };
};
