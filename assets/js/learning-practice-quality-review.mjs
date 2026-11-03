import { BACKEND_CONFIG } from "./backend/config.mjs";
import { createSupabaseAuthClient } from "./backend/auth.mjs";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function safeCandidate(candidate) {
  if (!isObject(candidate) || !isObject(candidate.context) || !isObject(candidate.exercise)) {
    throw new TypeError("候选题数据不完整，无法提交质量审查。");
  }
  return {
    candidateId: String(candidate.candidateId || ""),
    schemaVersion: Number(candidate.schemaVersion) || 1,
    purpose: "learning_practice_candidate",
    context: {
      competencyId: candidate.context.competencyId,
      gapId: candidate.context.gapId,
      topicId: candidate.context.topicId,
      competencyTitle: candidate.context.competencyTitle,
      topicTitle: candidate.context.topicTitle,
      gapLabel: candidate.context.gapLabel,
      allowedSourceVariantIds: Array.isArray(candidate.context.allowedSourceVariantIds)
        ? candidate.context.allowedSourceVariantIds : candidate.exercise.sourceVariantIds,
    },
    exercise: candidate.exercise,
  };
}

export function createLearningPracticeQualityReviewClient(options = {}) {
  const config = options.config || BACKEND_CONFIG;
  const auth = options.auth || createSupabaseAuthClient(config);

  async function request(action, data = {}) {
    const { signal, ...payload } = data;
    const session = await auth.getSession();
    if (!session?.access_token) {
      const error = new Error("查看质量审查和调用独立 Reviewer 前，需要先使用已授权账户登录。");
      error.code = "PRACTICE_QUALITY_AUTH_REQUIRED";
      throw error;
    }
    const result = await auth.request("/functions/v1/practice-quality-review", {
      method: "POST",
      signal,
      body: { version: 1, action, ...payload },
    });
    if (!isObject(result)) throw new TypeError("质量审查服务返回了无效响应。");
    return result;
  }

  return {
    get configured() { return Boolean(config.enabled); },
    async history(candidateId) {
      return request("history", { candidateId: String(candidateId || "") });
    },
    async validate(candidate) {
      return request("validate", { candidate: safeCandidate(candidate) });
    },
    async review(candidate, options = {}) {
      return request("review", {
        candidate: safeCandidate(candidate),
        signal: options.signal,
      });
    },
    async approve(candidateId, reviewId, explicitConfirmation) {
      return request("approve", {
        candidateId: String(candidateId || ""),
        reviewId: String(reviewId || ""),
        explicitConfirmation: explicitConfirmation === true,
      });
    },
    async reject(candidateId, reason) {
      return request("reject", {
        candidateId: String(candidateId || ""),
        reason: String(reason || "").trim(),
      });
    },
    async prepareRegistration(candidateId) {
      return request("prepare_registration", { candidateId: String(candidateId || "") });
    },
    async delete(candidateId) {
      return request("delete", { candidateId: String(candidateId || "") });
    },
  };
}
