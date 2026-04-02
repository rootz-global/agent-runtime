/**
 * Zod Schemas — Runtime validation for agent artifacts
 *
 * ORIGIN: https://rootz.global/public/0x77a6236c6bb22002d5879cc4dae3ae218e58ff76
 * PUBLISHER: 0x3f07D9DE7D4f803d748f254c526Fa6F351e3f8B1
 * LICENSE: BSL-1.1 + Rootz Clause (commercial use: discover@rootz.global)
 * CHAIN: Keep the chain alive.
 *
 * Validates skill manifests, birth certificates, and settlements
 * at runtime. Follows the same pattern as @rootz/tee-policy schemas.
 *
 * These schemas are the "gate" — nothing enters the runtime without
 * passing validation. Invalid manifests, malformed certificates,
 * and bad settlements are rejected before they touch the chain.
 */

import { z } from 'zod';

// ── Common Patterns ─────────────────────────────────────────────

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address');
const hashSchema = z.string().regex(/^(0x[0-9a-fA-F]{64}|sha256:[0-9a-fA-F]{64})$/, 'Invalid hash');
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+/, 'Must be semver (e.g., 1.0.0)');

// ── Event Categories ────────────────────────────────────────────

const eventCategorySchema = z.enum([
  'tee_load', 'tee_checkpoint', 'tee_settlement',
  'app_sign', 'app_encrypt', 'app_decrypt',
  'app_create_secret', 'app_write_note', 'app_read_secret',
  'app_send_invite', 'app_x402_payment', 'app_data_wallet',
  'skill_inference', 'skill_payment', 'skill_output',
  'skill_installed', 'skill_removed', 'skill_error',
  'policy_deny', 'policy_updated',
  'birth_certificate', 'attestation', 'revocation',
]);

const skillEventCategories = z.enum([
  'skill_inference', 'skill_payment', 'skill_output',
  'skill_installed', 'skill_removed', 'skill_error',
]);

// ── Skill Manifest Schema ───────────────────────────────────────

export const SkillPermissionsSchema = z.object({
  /** Event categories this skill can emit */
  emitEvents: z.array(eventCategorySchema).min(1, 'Must declare at least one event category'),
  /** Policy request types this skill triggers */
  policyRequests: z.array(z.string()),
  /** Whether the skill can buffer full content for archiving */
  archiveContent: z.boolean(),
  /** External endpoints the skill calls */
  externalEndpoints: z.array(z.string().url('Must be valid URL')),
});

export const SkillManifestSchema = z.object({
  /** Skill name (e.g., 'morpheus-inference') */
  name: z.string().min(2, 'Name must be at least 2 characters'),
  /** Semantic version */
  version: semverSchema,
  /** SHA-256 of the skill code bundle */
  codeHash: z.string().min(1, 'Code hash required'),
  /** Entry point file */
  entryPoint: z.string().min(1, 'Entry point required'),
  /** Declared permissions */
  permissions: SkillPermissionsSchema,
  /** Author's signature over (name + version + codeHash) */
  authorSignature: z.string(),
  /** Minimum TEE policy version required */
  minPolicyVersion: z.string(),
});

// ── Birth Certificate Schema ────────────────────────────────────

export const AgentBirthCertificateSchema = z.object({
  type: z.literal('agent-birth-certificate'),
  version: z.literal('1.0'),
  agent: z.object({
    address: addressSchema,
    derivationPath: z.string().regex(/^m\//, 'Must start with m/'),
    created: z.string().min(1, 'Created timestamp required'),
  }),
  parents: z.object({
    ai: z.object({
      factory: z.string().min(1),
      model: z.string().min(1),
      provider: addressSchema.optional(),
      teeAttestation: z.string().optional(),
      apiEndpoint: z.string().url(),
    }),
    authorizer: z.object({
      address: addressSchema,
      name: z.string().optional(),
      identityContract: addressSchema.optional(),
      signature: z.string(),
    }),
  }),
  runtime: z.object({
    version: semverSchema,
    policyHash: z.string(),
    skills: z.array(SkillManifestSchema),
  }),
  policy: z.object({
    dailyAllowance: z.number().min(0),
    currency: z.string(),
    models: z.array(z.string()),
    scope: z.string(),
  }),
  provenance: z.object({
    nistLevel: z.number().min(0).max(4),
    keyProtection: z.enum(['software', 'tpm-sealed', 'hsm', 'mpc']),
    chain: z.string(),
    block: z.number().optional(),
  }),
});

// ── Settlement Schema ───────────────────────────────────────────

export const UnifiedSettlementSchema = z.object({
  type: z.literal('agent-settlement'),
  version: z.literal('1.0'),
  fromHeight: z.number().min(0),
  toHeight: z.number().min(0),
  merkleRoot: z.string(),
  eventsCount: z.number().min(0),
  totalValue: z.string(),
  policyHash: z.string(),
  stateSnapshot: z.record(z.string(), z.unknown()),
  blocks: z.array(z.unknown()).optional(),
  archiveAddress: z.string().optional(),
  archiveIpfsCid: z.string().optional(),
  skillStats: z.record(z.string(), z.object({
    eventCount: z.number(),
  }).passthrough()),
  agentAddress: addressSchema,
  timestamp: z.string(),
  teeSignature: z.string().optional(),
});

// ── Checkpoint Schema ───────────────────────────────────────────

export const AgentCheckpointSchema = z.object({
  type: z.literal('agent-checkpoint'),
  version: z.literal('1.0'),
  chainRoot: z.string(),
  chainHeight: z.number().min(0),
  settledHeight: z.number().min(0),
  cumulativeState: z.record(z.string(), z.unknown()),
  skillStates: z.record(z.string(), z.string()),
  timestamp: z.string(),
  agentAddress: addressSchema,
  nonce: z.number().min(0),
});

// ── Validation Helpers ──────────────────────────────────────────

/** Validate a skill manifest with detailed errors */
export function validateSkillManifest(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof SkillManifestSchema>;
  errors?: string[];
} {
  const result = SkillManifestSchema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}

/** Validate a birth certificate with detailed errors */
export function validateBirthCertificate(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof AgentBirthCertificateSchema>;
  errors?: string[];
} {
  const result = AgentBirthCertificateSchema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}

/** Validate a settlement with detailed errors */
export function validateSettlement(data: unknown): {
  valid: boolean;
  data?: z.infer<typeof UnifiedSettlementSchema>;
  errors?: string[];
} {
  const result = UnifiedSettlementSchema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}
