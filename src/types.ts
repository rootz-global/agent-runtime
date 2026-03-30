/**
 * @rootz/agent-runtime — Unified Type Definitions
 *
 * One type system for the entire agent runtime.
 * Merges Agent TEE (ChainOperation, InternalBlock) with
 * Morpheus Agent (ActionNote, BirthCertificate, Settlement).
 *
 * Design principle: ChainOperation envelope (has policy fields) +
 * optional meta for skill-specific data. One chain, one settlement.
 *
 * TEE is the container. Skills are loaded code. Secrets are state.
 */

// ═══════════════════════════════════════════════════════════════════
// EVENT CATEGORIES — Every operation in the agent's life
// ═══════════════════════════════════════════════════════════════════

/** All possible event categories in the unified chain */
export type EventCategory =
  // TEE container operations (no policy check, decision = 'CONTAINER')
  | 'tee_load'
  | 'tee_checkpoint'
  | 'tee_settlement'
  // Wallet operations (pass through policy engine)
  | 'app_sign'
  | 'app_encrypt'
  | 'app_decrypt'
  | 'app_create_secret'
  | 'app_write_note'
  | 'app_read_secret'
  | 'app_send_invite'
  | 'app_x402_payment'
  | 'app_data_wallet'
  // Skill events (policy-checked, skill context required)
  | 'skill_inference'
  | 'skill_payment'
  | 'skill_output'
  | 'skill_installed'
  | 'skill_removed'
  | 'skill_error'
  // Policy and lifecycle
  | 'policy_deny'
  | 'policy_updated'
  | 'birth_certificate'
  | 'attestation'
  | 'revocation';

// ═══════════════════════════════════════════════════════════════════
// AGENT EVENT — The canonical operation record
// ═══════════════════════════════════════════════════════════════════

/**
 * Every operation in the agent's life is an AgentEvent.
 * Merges TEE's ChainOperation (policy fields) with Morpheus's
 * ActionNote (skill metadata) into a single canonical type.
 */
export interface AgentEvent {
  /** Event category */
  category: EventCategory;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** SHA-256 of the input (never raw content) */
  inputHash: string;
  /** SHA-256 of the output */
  outputHash: string;
  /** Which policy rule was evaluated */
  policyRule: string;
  /** Policy decision */
  decision: 'ALLOW' | 'DENY' | 'AUTO' | 'CONTAINER';
  /** Value involved (wei), '0' if no value transfer */
  value: string;
  /** Counterparty address */
  counterparty: string;
  /** Reason (logged, NEVER evaluated by policy) */
  reason: string;
  /** Skill that produced this event (filled for skill_* categories) */
  skillId?: string;
  /** Skill version */
  skillVersion?: string;
  /** Skill-specific metadata (model, tokens, latency, etc.) */
  meta?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// INTERNAL CHAIN — Merkle-linked blocks of events
// ═══════════════════════════════════════════════════════════════════

/** A single block in the internal chain */
export interface InternalBlock {
  /** Monotonically increasing block number */
  height: number;
  /** Hash of previous block (genesis = 0x000...000) */
  previousHash: string;
  /** Events in this block */
  events: AgentEvent[];
  /** Merkle root of events in this block */
  eventsRoot: string;
  /** Cumulative state after this block */
  cumulativeState: CumulativeState;
  /** Block creation timestamp (unix ms) */
  timestamp: number;
  /** Agent's signature over this block */
  signature: string;
}

/** Running totals tracked by the chain */
export interface CumulativeState {
  // ── TEE counters (from original ChainOperation) ──
  /** Total signing operations (successful) */
  totalSigned: number;
  /** Total denied operations */
  totalDenied: number;
  /** Total value transferred (wei, as string) */
  totalValueTransferred: string;
  /** Value transferred in current 24h window (wei) */
  dailyValueTransferred: string;
  /** Value transferred in current 7d window (wei) */
  weeklyValueTransferred: string;
  /** Start of current daily window (unix ms) */
  dayStartTimestamp: number;
  /** Start of current weekly window (unix ms) */
  weekStartTimestamp: number;
  /** Total secrets created */
  secretsCreated: number;
  /** Total notes written */
  notesWritten: number;
  /** Total x402 payments made */
  x402PaymentsMade: number;
  // ── Skill counters (new, from Morpheus merge) ──
  /** Total inference calls across all skills */
  totalInferenceCalls: number;
  /** Total inference tokens across all skills */
  totalInferenceTokens: number;
  /** Total skill events (all categories) */
  totalSkillEvents: number;
  /** Per-skill event counters */
  skillCounters: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════
// SKILL MODEL — Loaded code modules with manifests
// ═══════════════════════════════════════════════════════════════════

/**
 * Skill manifest — declares what a skill is, what it can do,
 * and who signed it. Verified at load time by the TEE.
 */
export interface SkillManifest {
  /** Skill name (e.g., 'morpheus-inference') */
  name: string;
  /** Semantic version */
  version: string;
  /** SHA-256 of the skill code bundle */
  codeHash: string;
  /** Entry point file (e.g., './morpheus-skill.js') */
  entryPoint: string;
  /** Declared permissions */
  permissions: SkillPermissions;
  /** Author's signature over (name + version + codeHash) */
  authorSignature: string;
  /** Minimum TEE policy version required */
  minPolicyVersion: string;
}

/** What a skill is allowed to do */
export interface SkillPermissions {
  /** Event categories this skill can emit */
  emitEvents: EventCategory[];
  /** Policy request types this skill triggers */
  policyRequests: string[];
  /** Whether the skill can buffer full content for archiving */
  archiveContent: boolean;
  /** External endpoints the skill calls */
  externalEndpoints: string[];
}

/**
 * Skill interface — what every skill must implement.
 * Skills are loaded into the TEE runtime and produce events.
 */
export interface AgentSkill {
  /** The skill's manifest (identity + permissions) */
  readonly manifest: SkillManifest;

  /**
   * Called once when the skill is loaded into the runtime.
   * The context provides signing, event recording, and state access.
   */
  initialize(ctx: SkillContext): Promise<void>;

  /**
   * Called at settlement time. Returns full session content for archiving.
   * If the skill doesn't produce archivable content, return undefined.
   */
  getSessionContent?(): string | undefined;

  /**
   * Called on shutdown or when the skill is unloaded.
   */
  shutdown?(): Promise<void>;
}

/**
 * Context provided to a skill by the runtime.
 * The skill uses this to interact with the agent without
 * direct access to keys or chain internals.
 */
export interface SkillContext {
  /** Sign a message (goes through policy engine + Desktop relay) */
  sign(message: string, reason: string): Promise<string>;
  /** Record an event on the internal chain */
  recordEvent(event: Omit<AgentEvent, 'timestamp'>): Promise<number>;
  /** Get current cumulative state (read-only) */
  getState(): Readonly<CumulativeState>;
  /** Agent's public address */
  agentAddress: string;
  /** Skill-specific configuration (from the policy's skills section) */
  config: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// BIRTH CERTIFICATE — Agent genesis record (Note 0)
// ═══════════════════════════════════════════════════════════════════

/**
 * The agent's permanent origin record. Names two parents:
 * the AI that gives it capability and the key-holder who gives it authority.
 *
 * Follows TCG DICE: identity composed from layers
 * (hardware → platform → agent → session).
 */
export interface AgentBirthCertificate {
  type: 'agent-birth-certificate';
  version: '1.0';
  agent: {
    /** Agent wallet address (secp256k1) */
    address: string;
    /** BIP-32 derivation path from owner seed */
    derivationPath: string;
    /** ISO 8601 creation timestamp */
    created: string;
  };
  parents: {
    ai: {
      /** AI provider network (e.g., 'morpheus') */
      factory: string;
      /** Model used (e.g., 'kimi-k2.5') */
      model: string;
      /** Provider wallet address */
      provider?: string;
      /** TEE attestation hash at creation */
      teeAttestation?: string;
      /** API endpoint */
      apiEndpoint: string;
    };
    authorizer: {
      /** Key-holder address (not assumed human) */
      address: string;
      /** Human-readable name (optional) */
      name?: string;
      /** Identity contract address (if multi-device) */
      identityContract?: string;
      /** Authorizer's signature over the birth certificate */
      signature: string;
    };
  };
  runtime: {
    /** Agent runtime version */
    version: string;
    /** SHA-256 of the initial policy */
    policyHash: string;
    /** Skills loaded at genesis */
    skills: SkillManifest[];
  };
  policy: {
    /** Daily spending allowance */
    dailyAllowance: number;
    /** Currency for allowance */
    currency: string;
    /** Approved models */
    models: string[];
    /** Agent scope description */
    scope: string;
  };
  provenance: {
    /** NIST assurance level (0-4) */
    nistLevel: number;
    /** Key protection method */
    keyProtection: 'software' | 'tpm-sealed' | 'hsm' | 'mpc';
    /** Blockchain (e.g., 'polygon') */
    chain: string;
    /** Block number of birth transaction */
    block?: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SETTLEMENT — Periodic chain anchor
// ═══════════════════════════════════════════════════════════════════

/** Settlement Note — written to Sovereign Secret at session end */
export interface UnifiedSettlement {
  type: 'agent-settlement';
  version: '1.0';
  /** Block range covered */
  fromHeight: number;
  toHeight: number;
  /** Merkle root covering all blocks in range */
  merkleRoot: string;
  /** Number of events settled */
  eventsCount: number;
  /** Total value transferred during this period */
  totalValue: string;
  /** Policy hash at settlement time */
  policyHash: string;
  /** State snapshot for recovery */
  stateSnapshot: CumulativeState;
  /** Full block data for verification (optional, can be large) */
  blocks?: InternalBlock[];
  /** Archive pointer — where the full session content lives */
  archiveAddress?: string;
  /** IPFS CID for the archive content */
  archiveIpfsCid?: string;
  /** Per-skill statistics */
  skillStats: Record<string, {
    eventCount: number;
    [key: string]: unknown;
  }>;
  /** Agent address */
  agentAddress: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** TEE co-signature (if running in enclave) */
  teeSignature?: string;
}

// ═══════════════════════════════════════════════════════════════════
// CHECKPOINT / RESUME — State persistence for portability
// ═══════════════════════════════════════════════════════════════════

/**
 * Checkpoint Note — written to Sovereign Secret for state recovery.
 * Any attested instance can resume from the latest checkpoint.
 */
export interface AgentCheckpoint {
  type: 'agent-checkpoint';
  version: '1.0';
  /** Merkle root of entire chain */
  chainRoot: string;
  /** Total block count */
  chainHeight: number;
  /** How far we've settled */
  settledHeight: number;
  /** Full cumulative state */
  cumulativeState: CumulativeState;
  /** Per-skill serialized state hashes */
  skillStates: Record<string, string>;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Agent address */
  agentAddress: string;
  /** Monotonically increasing (anti-replay) */
  nonce: number;
}

// ═══════════════════════════════════════════════════════════════════
// POLICY — What the agent is allowed to do
// ═══════════════════════════════════════════════════════════════════

/** Policy decision result */
export interface PolicyDecision {
  /** The verdict */
  decision: 'ALLOW' | 'DENY' | 'AUTO';
  /** Which rule produced this decision */
  rule: string;
  /** Human-readable explanation */
  reason: string;
}

/** Policy request — what gets evaluated */
export type PolicyRequest =
  | { type: 'sign'; signType: string; to?: string; value?: string; data?: string }
  | { type: 'encrypt'; recipientAddress: string; dataSize: number }
  | { type: 'decrypt'; senderAddress: string; dataSize: number }
  | { type: 'create_secret'; secretType: string; contentSize: number }
  | { type: 'write_note'; secretAddress: string; contentSize: number }
  | { type: 'read_secret'; secretAddress: string }
  | { type: 'send_invite'; secretAddress: string; memberAddress: string }
  | { type: 'x402_payment'; recipientAddress: string; amount: string; tokenAddress: string }
  | { type: 'data_wallet'; documentSize: number }
  | { type: 'settle'; force: boolean }
  | { type: 'skill_event'; skillId: string; category: EventCategory; value: string };

// ═══════════════════════════════════════════════════════════════════
// CODE DELIVERY — Skills delivered via wallet Notes
// ═══════════════════════════════════════════════════════════════════

/** Code delivery Note — owner writes to agent's Sovereign Secret */
export interface CodeDeliveryNote {
  type: 'agent-code-delivery';
  version: '1.0';
  action: 'install' | 'update' | 'remove';
  skill: {
    name: string;
    version: string;
    codeHash: string;
    code?: string;       // Base64-encoded module (for install/update)
    entryPoint?: string;
  };
  /** Owner's signature over (name + version + codeHash) */
  ownerSignature: string;
  timestamp: string;
}

/** Revocation Note — owner kills the agent */
export interface RevocationNote {
  type: 'agent-revocation';
  version: '1.0';
  reason: string;
  ownerSignature: string;
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════
// ATTESTATION — Proof of runtime integrity
// ═══════════════════════════════════════════════════════════════════

/** Attestation report produced by the runtime */
export interface AttestationReport {
  /** Runtime software version */
  runtimeVersion: string;
  /** Agent's public address */
  agentAddress: string;
  /** SHA-256 of loaded policy */
  policyHash: string;
  /** Merkle root of internal chain */
  chainRoot: string;
  /** Current chain height */
  chainHeight: number;
  /** Hash of current runtime state */
  stateHash: string;
  /** External challenge (echoed) */
  challenge: string;
  /** Loaded skill manifests */
  skills: SkillManifest[];
  /** ISO 8601 timestamp */
  timestamp: string;
  /** TPM PCR0 (if available) */
  pcr0?: string;
  /** Agent's signature over this report */
  signature: string;
}
