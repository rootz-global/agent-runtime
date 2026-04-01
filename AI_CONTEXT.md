# @rootz/agent-runtime — AI Context

**Version**: 0.1.0
**Location**: `rootz-v6/packages/agent-runtime/`
**Role**: Unified agent runtime — one chain, one settlement, one policy boundary
**Status**: Active build — v0.1.0 types + chain + skill loader complete

---

## FOR AI ASSISTANTS: Read This First

This is the canonical runtime for Rootz AI agents. If you're working on ANY agent-related code in the Rootz ecosystem, start here.

**Core model**: TEE is the container. Skills are loaded code. Secrets are state.

**What this package provides**:
- `AgentEvent` — the canonical operation type (replaces both ChainOperation and ActionNote)
- `InternalChain` — the single Merkle chain for all operations
- `SkillRegistry` — validates and manages loaded skills
- `AgentBirthCertificate` — genesis record naming AI parent + key-holder authorizer
- `UnifiedSettlement` — periodic chain anchor with archive pointers
- `AgentCheckpoint` — state recovery for portable agents

**What uses this package**:
- `apps/agent-tee/` — TEE core uses InternalChain + types (migration in progress)
- `apps/morpheus-agent/` — MorpheusSkill implements AgentSkill interface
- Future: `packages/agent-wallet/` — SDK for external developers

---

## Quick Start (Copy-Paste Ready)

### Record an event
```typescript
import { InternalChain } from '@rootz/agent-runtime';

const chain = new InternalChain(signer);
await chain.recordGenesis(policyHash);

await chain.recordEvent({
  category: 'skill_inference',
  inputHash: '0x...',        // SHA-256 of prompt
  outputHash: '0x...',       // SHA-256 of response
  policyRule: 'skill_inference',
  decision: 'ALLOW',
  value: '0',
  counterparty: '0x...',     // provider address
  reason: 'Morpheus inference call',
  skillId: 'morpheus-inference',
  meta: { model: 'kimi-k2.5', totalTokens: 1542, latencyMs: 27094 },
});
```

### Settle a session
```typescript
const settlement = chain.getSettlementData(policyHash, agentAddress);
// Write settlement to Sovereign Secret via Desktop relay...
chain.markSettled(settlement.toHeight);
```

### Validate a skill manifest
```typescript
import { validateManifest, SkillRegistry } from '@rootz/agent-runtime';

const result = validateManifest(skill.manifest);
if (!result.valid) throw new Error(result.errors.join(', '));

const registry = new SkillRegistry();
await registry.loadSkill(skill, ctx);
```

### Create a birth certificate
```typescript
import type { AgentBirthCertificate } from '@rootz/agent-runtime';

const cert: AgentBirthCertificate = {
  type: 'agent-birth-certificate',
  version: '1.0',
  agent: { address: '0x...', derivationPath: "m/44'/60'/0'/1/0", created: new Date().toISOString() },
  parents: {
    ai: { factory: 'morpheus', model: 'kimi-k2.5', apiEndpoint: 'https://api.mor.org/api/v1' },
    authorizer: { address: '0x...', name: 'Steven Sprague', signature: '0x...' },
  },
  runtime: { version: '0.1.0', policyHash: '0x...', skills: [morpheusSkill.manifest] },
  policy: { dailyAllowance: 100, currency: 'MOR', models: ['kimi-k2.5'], scope: 'research' },
  provenance: { nistLevel: 2, keyProtection: 'tpm-sealed', chain: 'polygon' },
};
```

---

## File Map

| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| `src/types.ts` | ~400 | 20+ types | Everything: AgentEvent, CumulativeState, SkillManifest, AgentSkill, SkillContext, BirthCertificate, Settlement, Checkpoint, PolicyDecision |
| `src/internal-chain.ts` | ~250 | `InternalChain`, `computeMerkleRoot` | The single Merkle chain — records events, computes roots, settles, checkpoints |
| `src/skill-loader.ts` | ~200 | `SkillRegistry`, `validateManifest`, `verifyCodeHash` | Manifest validation, code hash verification, skill lifecycle |
| `src/index.ts` | ~30 | re-exports | Public API |

---

## Event Categories (~25 types)

| Category | Layer | Policy Check | Description |
|----------|-------|-------------|-------------|
| `tee_load` | Container | No | Runtime booted, policy loaded |
| `tee_checkpoint` | Container | No | State checkpointed |
| `tee_settlement` | Container | No | Chain settled to blockchain |
| `app_sign` | Wallet | Yes | Message or transaction signed |
| `app_encrypt` / `app_decrypt` | Wallet | Yes | ECDH encryption/decryption |
| `app_create_secret` | Wallet | Yes | New Secret created on-chain |
| `app_write_note` | Wallet | Yes | Note written to Secret |
| `app_read_secret` | Wallet | Yes | Secret content read |
| `app_x402_payment` | Wallet | Yes | x402 payment signed |
| `skill_inference` | Skill | Yes | AI inference call |
| `skill_payment` | Skill | Yes | Payment by skill |
| `skill_output` | Skill | Yes | Work product produced |
| `skill_installed` / `skill_removed` | Skill | Yes | Skill lifecycle |
| `skill_error` | Skill | Yes | Error recorded |
| `policy_deny` / `policy_updated` | Policy | N/A | Policy events |
| `birth_certificate` | Lifecycle | N/A | Agent genesis |
| `attestation` | Lifecycle | N/A | Runtime integrity proof |
| `revocation` | Lifecycle | N/A | Agent killed by owner |

---

## How Skills Work

A skill implements `AgentSkill`:
```typescript
interface AgentSkill {
  readonly manifest: SkillManifest;
  initialize(ctx: SkillContext): Promise<void>;
  getSessionContent?(): string | undefined;  // For archiving
  shutdown?(): Promise<void>;
}
```

The `SkillContext` provides:
- `ctx.sign(message, reason)` → routes through TEE policy engine → Desktop TPM
- `ctx.recordEvent(event)` → records in the unified Merkle chain
- `ctx.getState()` → read-only cumulative state
- `ctx.agentAddress` — the agent's public address

**Skills never touch keys.** They sign through the context. They record through the context. They read state through the context. The TEE controls everything.

---

## Relationship to Other Packages

```
@rootz/agent-runtime (THIS)
    ↑ used by
    ├── apps/agent-tee (TEE container — loads skills, enforces policy)
    ├── apps/morpheus-agent (Skill #1 — Morpheus inference)
    └── packages/agent-wallet (future SDK for external devs)

    ↓ uses
    └── ethers (keccak256, signing, ZeroAddress)
```

---

## Design Documents

- `rootz-v6/docs/DESIGN-unified-agent-runtime.md` — Full architecture
- `rootz-v6/docs/DESIGN-hsm-agent-network.md` — HSM evolution path
- `claud project/docs/DESIGN-morpheus-agent-data-wallet.md` — Four layers + birth certs
- `claud project/docs/BUSINESS-unified-agent-licensing.md` — Licensing (CONFIDENTIAL)

---

## Current State
- **Last Change**: evt-2026-03-31-init
- **By**: steven / claude-opus-4-6
- **Summary**: Initial build — unified types, InternalChain (moved from agent-tee + extended with skill counters), SkillRegistry with manifest validation
- **Status**: compiling clean, not yet integrated as import in agent-tee (uses local types still)
- **Next**: Week 2 Day 8-9 — Zod validation for skill manifests, birth cert with runtime.skills[]

---

*Last updated: 2026-03-31 by Claude Opus 4.6*
