// Provider registry — selects an adapter by capability + feature flag (P2/T2.3).
// Adapters are registered by code; secrets are read by NAME inside adapters only.
// A provider is only eligible for a capability after satisfiesCapability() passes.

import { CAPABILITIES, satisfiesCapability, validateAdapterSurface, err, makeAIError } from "./port.mjs";

const registry = new Map(); // name -> { descriptor, adapter }

export function registerProvider(name, descriptor, adapter) {
  if (typeof name !== "string" || !name) throw new Error("provider name required");
  const problems = validateAdapterSurface(adapter);
  if (problems.length) throw new Error(`invalid adapter ${name}: ${problems.join(", ")}`);
  registry.set(name, Object.freeze({ descriptor: Object.freeze({ ...descriptor, name }), adapter }));
}

/** Eligible provider names for a capability, in registration order. */
export function eligibleProviders(capabilityName) {
  return [...registry.entries()]
    .filter(([, entry]) => satisfiesCapability(entry.descriptor, capabilityName))
    .map(([name]) => name);
}

/**
 * Resolve a provider for a capability.
 * @param {string} capabilityName
 * @param {{preferred?:string, flags?:object, allowFallback?:boolean}} opts
 * @returns {{ok:true, name:string, adapter:object}|{ok:false, error:object}}
 */
export function resolveProvider(capabilityName, opts = {}) {
  if (!CAPABILITIES[capabilityName]) return err(makeAIError("AI_INVALID_OUTPUT", `unknown capability ${capabilityName}`));
  const flags = opts.flags || {};
  const candidates = eligibleProviders(capabilityName);
  if (!candidates.length) return err(makeAIError("AI_PROVIDER_ERROR", `no eligible provider for ${capabilityName}`));

  const primary = opts.preferred || flags.AI_PROVIDER_PRIMARY || candidates[0];
  const ordered = [primary, candidates.find((c) => c !== primary)].filter(Boolean);
  for (const name of ordered) {
    const entry = registry.get(name);
    if (entry && satisfiesCapability(entry.descriptor, capabilityName)) {
      return { ok: true, name, adapter: entry.adapter };
    }
  }
  return err(makeAIError("AI_PROVIDER_ERROR", "preferred provider not eligible"));
}

/** Test-only: clear registry between tests. */
export function _resetRegistry() { registry.clear(); }
