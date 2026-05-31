import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeEvalArgs } from "../../../src/test-utils/node-process.js";

type CommandResult = {
  stdout: string;
  stderr: string;
};

const COMMAND_TIMEOUT_MS = 120_000;
const tempDirs: string[] = [];

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `command timed out after ${options.timeoutMs ?? COMMAND_TIMEOUT_MS}ms: ${[
            command,
            ...args,
          ].join(" ")}`,
        ),
      );
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const result = { stdout: stdout.join(""), stderr: stderr.join("") };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(
        new Error(
          `command failed (${String(code ?? signal)}): ${[command, ...args].join(" ")}\n` +
            `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        ),
      );
    });
  });
}

async function runPnpm(args: string[], options: { cwd: string; timeoutMs?: number }) {
  try {
    return await runCommand("pnpm", args, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return runCommand("corepack", ["pnpm", ...args], options);
  }
}

describe("OpenClaw SDK package e2e", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("packs and imports from an external temp consumer", async () => {
    const repoRoot = process.cwd();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sdk-consumer-"));
    tempDirs.push(tempDir);

    await runPnpm(
      [
        "--filter",
        "@openclaw/gateway-protocol",
        "--filter",
        "@openclaw/gateway-client",
        "--filter",
        "@openclaw/sdk",
        "build",
      ],
      {
        cwd: repoRoot,
        timeoutMs: 180_000,
      },
    );

    const packageTarballs: string[] = [];
    for (const workspacePackage of [
      "packages/gateway-protocol",
      "packages/gateway-client",
      "packages/sdk",
    ]) {
      const packRoot = path.join(repoRoot, workspacePackage);
      await runPnpm(["pack", "--pack-destination", tempDir], {
        cwd: packRoot,
      });
      const packedFiles = (await fs.readdir(tempDir))
        .filter((file) => file.endsWith(".tgz"))
        .map((file) => path.join(tempDir, file));
      const newTarball = packedFiles.find((file) => !packageTarballs.includes(file));
      if (!newTarball) {
        throw new Error(`pnpm pack did not create a tarball for ${workspacePackage}`);
      }
      packageTarballs.push(newTarball);
    }

    const sdkTarball = packageTarballs.find((file) => path.basename(file).includes("openclaw-sdk"));
    expect(sdkTarball).toBeTruthy();

    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await runCommand(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packageTarballs],
      {
        cwd: tempDir,
        timeoutMs: 120_000,
      },
    );

    const importScript = `
      import { GatewayClientTransport, OpenClaw, normalizeGatewayEvent } from "@openclaw/sdk";
      if (typeof GatewayClientTransport !== "function") throw new Error("missing transport export");
      if (typeof OpenClaw !== "function") throw new Error("missing client export");
      const event = normalizeGatewayEvent({
        event: "agent",
        payload: { runId: "pack-smoke", stream: "lifecycle", data: { phase: "start" } }
      });
      if (event.type !== "run.started") throw new Error("unexpected event normalization");
    `;
    await runCommand(process.execPath, createNodeEvalArgs(importScript, { evalFlag: "-e" }), {
      cwd: tempDir,
    });
  });
});
