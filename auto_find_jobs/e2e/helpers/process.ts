import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";

export interface ManagedProcess {
  close: () => Promise<void>;
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

export const waitForUrl = async (
  url: string,
  timeoutMs = 45_000,
  predicate?: (response: Response) => boolean
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (!predicate || predicate(response)) {
        return;
      }
    } catch {
      // keep polling
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

export const getAvailablePort = async (): Promise<number> =>
  await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("Could not determine a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
    server.on("error", rejectPort);
  });

const normalizeEnv = (
  env: NodeJS.ProcessEnv & Record<string, string | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

export const spawnProcess = (input: {
  cwd: string;
  args: string[];
  logPath: string;
  env?: Record<string, string>;
}): ManagedProcess => {
  const command = process.platform === "win32" ? "cmd.exe" : pnpmCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", pnpmCommand, ...input.args]
      : input.args;

  const child = spawn(command, commandArgs, {
    cwd: input.cwd,
    env: normalizeEnv({
      ...process.env,
      ...input.env
    }),
    stdio: "pipe",
    windowsHide: true
  });

  child.stdout?.on("data", async (chunk) => {
    await writeFile(input.logPath, chunk, { flag: "a" });
  });
  child.stderr?.on("data", async (chunk) => {
    await writeFile(input.logPath, chunk, { flag: "a" });
  });

  child.on("exit", async (code) => {
    if (code && code !== 0) {
      await writeFile(input.logPath, `\nProcess exited with code ${code}\n`, { flag: "a" });
    }
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }

      if (process.platform === "win32") {
        await new Promise<void>((resolveClose) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore"
          });
          killer.on("exit", () => resolveClose());
        });
        return;
      }

      child.kill("SIGTERM");
      await new Promise<void>((resolveClose) => {
        child.on("exit", () => resolveClose());
      });
    }
  };
};
