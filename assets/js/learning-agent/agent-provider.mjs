import { BACKEND_CONFIG } from "../backend/config.mjs";
import { createSupabaseAuthClient } from "../backend/auth.mjs";
import { AGENT_TOOL_SCHEMAS, validateAgentToolInput } from "./agent-tools.mjs";

const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_BYTES = 20_000;
const isObject = value => value && typeof value === "object" && !Array.isArray(value);

export function validateAgentProviderResponse(value) {
  if (!isObject(value) || typeof value.reply !== "string" || !value.reply.trim() || value.reply.length > 6000) {
    throw new TypeError("AI 返回内容不符合 Learning Agent 响应协议。");
  }
  const suggestions = Array.isArray(value.suggestions) ? value.suggestions : [];
  if (suggestions.length > 4) throw new RangeError("AI 建议数量超过限制。");
  const normalized = suggestions.map((item, index) => {
    if (!isObject(item) || typeof item.toolName !== "string" ||
        !AGENT_TOOL_SCHEMAS[item.toolName] || !AGENT_TOOL_SCHEMAS[item.toolName].mutating ||
        !isObject(item.input)) {
      throw new TypeError("AI 第 " + (index + 1) + " 条建议不是允许的工具提案。");
    }
    validateAgentToolInput(item.toolName, item.input);
    return {
      toolName: item.toolName,
      input: item.input,
      label: typeof item.label === "string" ? item.label.slice(0, 120) : item.toolName,
      reason: typeof item.reason === "string" ? item.reason.slice(0, 500) : "",
    };
  });
  const dataRequests = Array.isArray(value.dataRequests) ? value.dataRequests : [];
  if (dataRequests.length > 3) throw new RangeError("AI 只允许申请最多 3 项只读学习数据。");
  const normalizedRequests = dataRequests.map((item, index) => {
    if (!isObject(item) || typeof item.toolName !== "string" ||
        !AGENT_TOOL_SCHEMAS[item.toolName] || AGENT_TOOL_SCHEMAS[item.toolName].mutating ||
        !isObject(item.input)) {
      throw new TypeError("AI 第 " + (index + 1) + " 条数据读取请求不是允许的只读工具。");
    }
    validateAgentToolInput(item.toolName, item.input);
    return { toolName: item.toolName, input: item.input };
  });
  return { reply: value.reply.trim(), suggestions: normalized, dataRequests: normalizedRequests };
}

export function createLearningAgentProvider(options = {}) {
  const config = options.config || BACKEND_CONFIG;
  const auth = options.auth || createSupabaseAuthClient(config);
  return {
    get configured() { return Boolean(config.enabled); },
    async ask({ message, context, signal, mode = "agent", tutorMode = "explain" } = {}) {
      if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_CHARS) {
        throw new TypeError("请输入 1–4000 字符的学习问题。");
      }
      if (!["agent", "tutor"].includes(mode)) throw new TypeError("不支持的 Learning Agent 请求模式。");
      if (!["explain", "hint", "diagnose", "transfer", "socratic"].includes(tutorMode)) {
        throw new TypeError("不支持的学习导师交互模式。");
      }
      const session = await auth.getSession();
      if (!session?.access_token) {
        const error = new Error("使用云端 AI 前需要先通过 GitHub 登录；本地规则学习能力无需登录。");
        error.code = "AI_AUTH_REQUIRED";
        throw error;
      }
      if (!isObject(context)) throw new TypeError("AI 学习上下文无效。");
      const contextText = JSON.stringify(context);
      if (new TextEncoder().encode(contextText).byteLength > MAX_CONTEXT_BYTES) {
        throw new RangeError("发送给 AI 的学习摘要过大，请缩小上下文范围。");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("AI 请求超时")), 30_000);
      const onAbort = () => controller.abort(signal.reason);
      if (signal?.aborted) controller.abort(signal.reason);
      else signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await auth.request("/functions/v1/learning-agent", {
          method: "POST",
          signal: controller.signal,
          body: { version: 1, message: message.trim(), context, mode, tutorMode },
        });
        if (response?.error) {
          const error = new Error(response.error.message || "AI Agent 请求失败。");
          error.code = response.error.code || "AI_AGENT_ERROR";
          throw error;
        }
        return validateAgentProviderResponse(response);
      } catch (error) {
        if (error.name === "AbortError" || controller.signal.aborted) {
          const timeoutError = new Error("AI 请求超时。你的本地学习数据未受影响，可以继续使用规则模式。");
          timeoutError.code = "AI_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
