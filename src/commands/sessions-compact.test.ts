import { beforeEach, describe, expect, it, vi } from "vitest";
import { callGateway } from "../gateway/call.js";
import { sessionsCompactCommand } from "./sessions-compact.js";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

const mockedCallGateway = vi.mocked(callGateway);

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("sessionsCompactCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the gateway sessions.compact method with CLI recovery params", async () => {
    const runtime = createRuntime();
    mockedCallGateway.mockResolvedValueOnce({
      ok: true,
      key: "agent:main:main",
      compacted: true,
    });

    await sessionsCompactCommand(
      {
        key: "agent:main:main",
        agent: "main",
        maxLines: 2000,
        timeoutMs: 30_000,
      },
      runtime,
    );

    expect(mockedCallGateway).toHaveBeenCalledWith({
      method: "sessions.compact",
      params: {
        key: "agent:main:main",
        agentId: "main",
        maxLines: 2000,
      },
      mode: "cli",
      clientName: "cli",
      requiredMethods: ["sessions.compact"],
      timeoutMs: 30_000,
    });
    expect(runtime.log).toHaveBeenCalledWith("Compacted session: agent:main:main");
  });

  it("prints a pending status for Codex-native compaction starts", async () => {
    const runtime = createRuntime();
    mockedCallGateway.mockResolvedValueOnce({
      ok: true,
      key: "agent:main:main",
      compacted: false,
      result: {
        details: {
          pending: true,
        },
      },
    });

    await sessionsCompactCommand({ key: "agent:main:main" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith("Compaction started for session: agent:main:main");
  });
});
