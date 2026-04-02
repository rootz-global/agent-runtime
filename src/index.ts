/**
 * @rootz/agent-runtime — Unified Agent Runtime
 *
 * One chain, one settlement, one policy boundary.
 * TEE is the container. Skills are loaded code. Secrets are state.
 *
 * @see AI_CONTEXT.md for full documentation
 * @see ../../docs/DESIGN-unified-agent-runtime.md for architecture
 */

// Types — the canonical event model
export type {
  EventCategory,
  AgentEvent,
  InternalBlock,
  CumulativeState,
  SkillManifest,
  SkillPermissions,
  AgentSkill,
  SkillContext,
  AgentBirthCertificate,
  UnifiedSettlement,
  AgentCheckpoint,
  PolicyDecision,
  PolicyRequest,
  CodeDeliveryNote,
  RevocationNote,
  AttestationReport,
  // MCP Proxy types
  McpConnection,
  McpConnectionPolicy,
  SkillPolicyPair,
} from './types.js';

// Internal Chain — the single Merkle ledger
export { InternalChain, computeMerkleRoot } from './internal-chain.js';

// Skill Loader — manifest validation + skill registry
export {
  validateManifest,
  verifyCodeHash,
  checkPermissionsAgainstPolicy,
  SkillRegistry,
} from './skill-loader.js';
export type { SkillValidationResult, LoadedSkill } from './skill-loader.js';

// Zod Schemas — runtime validation for manifests, birth certs, settlements
export {
  SkillManifestSchema,
  SkillPermissionsSchema,
  AgentBirthCertificateSchema,
  UnifiedSettlementSchema,
  AgentCheckpointSchema,
  validateSkillManifest,
  validateBirthCertificate,
  validateSettlement,
} from './schemas.js';
