import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = process.cwd();
const read = path => readFile(resolve(root, path), "utf8");

test("publication dispatch is trusted-develop-only and never auto-merges", async () => {
  const workflow = await read(".github/workflows/publish-approved-practice-candidate.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/);
  assert.match(workflow, /github\.repository == 'liucaidong\/knowverse'/);
  assert.match(workflow, /contents: write[\s\S]*pull-requests: write/);
  assert.match(workflow, /git push origin "\$branch"/);
  assert.doesNotMatch(workflow, /git push[^\n]*--force/i);
  assert.doesNotMatch(workflow, /gh pr merge|auto-merge|enable-auto-merge/i);
});

test("reused publication branches and PRs are recovered without history rewriting", async () => {
  const workflow = await read(".github/workflows/publish-approved-practice-candidate.yml");
  assert.match(workflow, /git fetch origin "\$branch"/);
  assert.match(workflow, /git merge --no-edit origin\/develop/);
  assert.match(workflow, /Existing open PR was revalidated/);
  assert.match(workflow, /merged PR already exists/);
  assert.match(workflow, /closed unmerged publication PR already exists/);
  assert.match(workflow, /Unexpected file in protected publication branch/);
  assert.match(workflow, /Protected publication commit is missing expected artifact/);
});

test("Pages callback accepts only successful develop deployment from the same repository", async () => {
  const workflow = await read(".github/workflows/publish-approved-practice-candidate.yml");
  const pages = await read(".github/workflows/pages.yml");
  assert.match(pages, /^name: Deploy KNOWVERSE to GitHub Pages$/m);
  assert.match(workflow, /workflows: \["Deploy KNOWVERSE to GitHub Pages"\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'develop'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /PAGES_DEPLOY_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /PAGES_WORKFLOW_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /permissions:\n      contents: read/);
});

test("registration requires exact live Pages JSON and immutable provenance before calling finalizer", async () => {
  const script = await read("scripts/verify-and-register-published-practice.mjs");
  const liveFetch = script.indexOf("await fetch(pagesRegistryUrl");
  const exactComparison = script.indexOf("stable(assessment) !== stable(liveAssessment)");
  const pendingSnapshot = script.indexOf("stable(pending.payload?.assessment) !== stable(assessment)");
  const prProvenance = script.indexOf("prRecords.length !== 1");
  const finalize = script.indexOf("/rest/v1/rpc/finalize_practice_candidate_registration");
  assert.ok(liveFetch >= 0 && exactComparison > liveFetch);
  assert.ok(pendingSnapshot > exactComparison);
  assert.ok(prProvenance > pendingSnapshot);
  assert.ok(finalize > prProvenance);
  assert.match(script, /cache: "no-store"/);
  assert.match(script, /pagesRegistryUrl \+ "\?deployment=" \+ deploymentSha/);
  assert.match(script, /PAGES_DEPLOY_SHA/);
  assert.match(script, /deploymentSha/);
  assert.match(script, /registeredRows\.length > 1/);
});

test("no public browser asset contains service-role or independent Reviewer API credentials", async () => {
  const roots = ["assets", "review", "content"];
  const forbidden = [/SUPABASE_SERVICE_ROLE_KEY/, /PRACTICE_REVIEWER_API_KEY/];
  async function walk(path) {
    const out = [];
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      const child = relative(root, resolve(root, path, entry.name));
      if (entry.isDirectory()) out.push(...await walk(child));
      else if (/\.(?:mjs|js|html|json|css)$/.test(entry.name)) out.push(child);
    }
    return out;
  }
  const files = (await Promise.all(roots.map(walk))).flat();
  for (const file of files) {
    const content = await read(file);
    for (const pattern of forbidden) assert.doesNotMatch(content, pattern, file);
  }
});

test("database audit RPCs fail closed for browser roles and retain content_admin approval checks", async () => {
  const migration = await read("supabase/migrations/20261103221527_phase_m_enforce_audit_provenance_chain.sql");
  assert.match(migration, /private\.is_practice_content_reviewer\(p_user_id\)/);
  assert.match(migration, /explicitConfirmation/);
  assert.match(migration, /matching_pass_review_required/);
  assert.match(migration, /matching_deterministic_validation_required/);
  assert.match(migration, /matching_publication_pr_proof_required/);
  assert.match(migration, /verified_pages_publication_required/);
  assert.match(migration, /revoke all on function public\.append_practice_candidate_quality_record/);
  assert.match(migration, /grant execute on function public\.append_practice_candidate_quality_record[\s\S]*to service_role/);
  assert.match(migration, /revoke insert on table public\.practice_candidate_quality_records from service_role/);
});

test("the independent Reviewer loads canonical content from an explicit safe ref and records the exact source", async () => {
  const edge = await read("supabase/functions/practice-quality-review/index.ts");
  assert.match(edge, /Deno\.env\.get\("KNOWVERSE_CONTENT_REF"\) \|\| "main"/);
  assert.match(edge, /canonical_content_ref_invalid/);
  assert.match(edge, /const base = `https:\/\/raw\.githubusercontent\.com\/liucaidong\/knowverse\/\$\{contentRef\}\/content\/`/);
  assert.match(edge, /canonicalRegistrySource: canonical\.sourceUrl/);
  assert.doesNotMatch(edge, /canonicalRegistrySource:\s*"https:\/\/raw\.githubusercontent\.com\/liucaidong\/knowverse\/main\//);
});

test("the audit history and duplicate scan have no fixed top-N cutoff", async () => {
  const edge = await read("supabase/functions/practice-quality-review/index.ts");
  assert.match(edge, /collectAllPracticePages/);
  assert.match(edge, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(edge, /allPracticeCandidateHistory\(existing\)/);
  assert.doesNotMatch(edge, /existing\.slice\(0,\s*30\)/);
  assert.doesNotMatch(edge, /\.limit\(300\)|\.limit\(2000\)/);
});
