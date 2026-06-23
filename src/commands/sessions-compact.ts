/**
 * Sessions compact command.
 *
 * Wraps the sessions.compact Gateway RPC behind `openclaw sessions compact <key>`
 * so wedged sessions have a documented, first-class recovery path. The command
 * propagates a non-zero exit whenever the gateway reports a failed compaction
 * so automation never mistakes a silent no-op for success.
 */
import { callGateway } from "../gateway/call.js";
import { formatErrorMessage } from "../infra/errors.js";
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
    tokensBefore?: number;
    tokensAfter?: number;
    sessionId?: string;
    sessionFile?: string;
    details?: {
      backend?: string;
      threadId?: string;
      signal?: string;
      pending?: boolean;
    };
  };
};

function formatCompactStatus(result: SessionsCompactGatewayResult, fallbackKey: string): string {
  const key = result.key ?? fallbackKey;
  const details = result.result?.details;
  if (!result.compacted) {
    if (details?.pending === true || details?.signal === "thread/compact/start") {
      return `Compaction started for session ${key} (pending; completion is reported asynchronously by the backend).`;
    }
    const reason = result.reason ? ` (${result.reason})` : "";
    return `No compaction needed for session ${key}${reason}.`;
  }

  const before = result.result?.tokensBefore;
  const after = result.result?.tokensAfter;
  let detail = "";
  if (typeof before === "number" && typeof after === "number") {
    detail = ` (${before} -> ${after} tokens)`;
  } else if (typeof result.kept === "number") {
    detail = ` (kept ${result.kept} lines)`;
  }
  return `Compacted session ${key}${detail}.`;
}

export async function sessionsCompactCommand(
  opts: SessionsCompactCommandOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  let result: SessionsCompactGatewayResult;
  try {
    result = await callGateway<SessionsCompactGatewayResult>({
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
  } catch (error) {
    const message = formatErrorMessage(error);
    if (opts.json) {
      writeRuntimeJson(runtime, { ok: false, key: opts.key, error: message });
    } else {
      runtime.error(`Compaction failed: ${message}`);
    }
    runtime.exit(1);
    return;
  }

  const failed = result?.ok !== true;
  if (opts.json) {
    writeRuntimeJson(runtime, result);
    if (failed) {
      runtime.exit(1);
    }
    return;
  }

  if (failed) {
    const key = result?.key ?? opts.key;
    const reason = result?.reason ? `: ${result.reason}` : "";
    runtime.error(`Compaction failed for session ${key}${reason}.`);
    runtime.exit(1);
    return;
  }

  runtime.log(formatCompactStatus(result, opts.key));
  if (result.archived) {
    runtime.log(`Archived transcript: ${result.archived}`);
  }
}
