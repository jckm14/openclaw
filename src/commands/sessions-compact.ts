import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime, writeRuntimeJson } from "../runtime.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";

export type SessionsCompactCommandOptions = {
  key: string;
  agent?: string;
  maxLines?: number;
  json?: boolean;
  timeoutMs?: number;
};

type SessionsCompactGatewayResult = {
  ok?: boolean;
  key?: string;
  compacted?: boolean;
  reason?: string;
  kept?: number;
  archived?: string;
  result?: {
    details?: {
      pending?: boolean;
    };
  };
};

function formatCompactStatus(result: SessionsCompactGatewayResult): string {
  const key = result.key ?? "session";
  if (result.compacted) {
    return `Compacted session: ${key}`;
  }
  if (result.result?.details?.pending) {
    return `Compaction started for session: ${key}`;
  }
  const reason = result.reason ? `: ${result.reason}` : "";
  return `Session not compacted: ${key}${reason}`;
}

export async function sessionsCompactCommand(
  opts: SessionsCompactCommandOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const result = await callGateway<SessionsCompactGatewayResult>({
    method: "sessions.compact",
    params: {
      key: opts.key,
      ...(opts.agent ? { agentId: opts.agent } : {}),
      ...(opts.maxLines !== undefined ? { maxLines: opts.maxLines } : {}),
    },
    mode: GATEWAY_CLIENT_MODES.CLI,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    requiredMethods: ["sessions.compact"],
    timeoutMs: opts.timeoutMs,
  });

  if (opts.json) {
    writeRuntimeJson(runtime, result);
    return;
  }
  runtime.log(formatCompactStatus(result));
}
