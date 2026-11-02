import { getLearningRepository } from "../backend/learning-repository.mjs";

const SESSION_TYPE = "learning_agent_session";
const MESSAGE_TYPE = "learning_agent_message";
const randomId = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
const nowIso = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));

export function createAgentSessionStore(options = {}) {
  const repositoryPromise = options.repository ? Promise.resolve(options.repository) : getLearningRepository();

  async function createSession() {
    const repository = await repositoryPromise;
    const sessionId = randomId("agent-session-");
    const at = nowIso();
    const payload = {
      sessionId,
      title: "学习规划与诊断",
      createdAt: at,
      updatedAt: at,
      latestMessageAt: null,
      messageCount: 0,
      contextScope: "local-learning-summary",
      version: 1,
    };
    await repository.documents.put({ type: SESSION_TYPE, key: sessionId, payload }, { accountId: null });
    return payload;
  }

  async function latestSession() {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    const sessions = rows.filter(row => row.type === SESSION_TYPE && !row.payload?._deleted)
      .map(row => ({ ...row.payload, localRevision: row.localRevision }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions[0] || createSession();
  }

  async function listMessages(sessionId) {
    const repository = await repositoryPromise;
    const rows = await repository.documents.list(1000);
    return rows.filter(row => row.type === MESSAGE_TYPE &&
      !row.payload?._deleted && row.payload.sessionId === sessionId)
      .map(row => row.payload)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function appendMessage(sessionId, role, content, metadata = {}) {
    if (!["user", "assistant", "system"].includes(role)) throw new TypeError("消息角色无效。");
    if (typeof content !== "string" || !content.trim() || content.length > 6000) {
      throw new TypeError("消息必须为 1–6000 字符。");
    }
    const repository = await repositoryPromise;
    const sessionRow = await repository.documents.get(SESSION_TYPE, sessionId);
    if (!sessionRow || sessionRow.payload?._deleted) throw new Error("Agent 会话不存在。");
    const messageId = randomId("agent-message-");
    const at = nowIso();
    const message = {
      messageId, sessionId, role, content: content.trim(),
      createdAt: at,
      metadata: {
        mode: metadata.mode || "rules",
        errorCode: metadata.errorCode || null,
        suggestions: Array.isArray(metadata.suggestions) ? metadata.suggestions.slice(0, 4) : [],
      },
    };
    const nextSession = {
      ...sessionRow.payload,
      updatedAt: at,
      latestMessageAt: at,
      messageCount: (Number(sessionRow.payload.messageCount) || 0) + 1,
    };
    await repository.commit({
      documents: [
        { type: MESSAGE_TYPE, key: messageId, payload: message, expectedLocalRevision: 0 },
        { type: SESSION_TYPE, key: sessionId, payload: nextSession, expectedLocalRevision: Number(sessionRow.localRevision) || 0 },
      ],
    });
    return message;
  }

  return { createSession, latestSession, listMessages, appendMessage };
}
