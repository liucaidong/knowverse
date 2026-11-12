const DIMENSION_BY_FINDING_CATEGORY = Object.freeze({
  source_alignment: "sourceAlignment",
  solvability: "solvability",
  answer_quality: "answerConsistency",
  code_semantics: "answerConsistency",
  pedagogical_quality: "pedagogicalQuality",
  registration_compatibility: "pedagogicalQuality",
});

export function normalizeReviewerDimensionStatuses(review) {
  if (!review || typeof review !== "object" || !Array.isArray(review.findings)) return review;

  for (const finding of review.findings) {
    if (!finding || !["high", "critical"].includes(finding.severity)) continue;
    const dimensionKey = DIMENSION_BY_FINDING_CATEGORY[finding.category];
    if (dimensionKey && review[dimensionKey]?.status === "pass") {
      review[dimensionKey].status = "concern";
    }
  }

  return review;
}
