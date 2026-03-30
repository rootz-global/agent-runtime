# @rootz/agent-runtime — AI Context

**Version**: 0.1.0
**Location**: `rootz-v6/packages/agent-runtime/`
**Role**: Unified agent runtime — one chain, one settlement, one policy boundary
**Status**: Development — v0.1.0 initial build (types, chain, skill loader)

---

## What This Is

The canonical runtime for Rootz AI agents. Merges Agent TEE (policy, Merkle chain, signing) with Morpheus Agent (birth certificates, inference logging, archiving) into one system.

**Core model**: TEE is the container. Skills are loaded code. Secrets are state.

---

## Key Files (in order of importance)

| File | Lines | What It Does |
|------|-------|-------------|
| `src/types.ts` | ~350 | All types: AgentEvent, CumulativeState, SkillManifest, AgentSkill, SkillContext, BirthCertificate, Settlement, Checkpoint |
| `src/internal-chain.ts` | ~250 | The single Merkle chain: records events, computes roots, settles, checkpoints |
| `src/skill-loader.ts` | ~200 | Manifest validation, code hash verification, SkillRegistry |
| `src/index.ts` | ~30 | Public exports |

## Dependencies

- `ethers` ^6.9.0 (keccak256, signing, ZeroAddress)

## Used By

- `apps/agent-tee/` — TEE core uses this as its chain + types
- `apps/morpheus-agent/` — MorpheusSkill implements AgentSkill interface
- Future: `packages/agent-wallet/` — SDK extracts from this

## Quick Start

```typescript
import {
  InternalChain,
  SkillRegistry,
  type AgentEvent,
  type AgentSkill,
  type SkillContext,
} from '@rootz/agent-runtime';

// Create chain with a signer
const chain = new InternalChain(signer);
await chain.recordGenesis(policyHash);

// Record a skill event
await chain.recordEvent({
  category: 'skill_inference',
  inputHash: promptHash,
  outputHash: responseHash,
  policyRule: 'skill_inference',
  decision: 'ALLOW',
  value: '0',
  counterparty: providerAddress,
  reason: 'Morpheus inference call',
  skillId: 'morpheus-inference',
  skillVersion: '0.2.1',
  meta: { model: 'kimi-k2.5', totalTokens: 1542, latencyMs: 27094 },
});

// Settle
const settlement = chain.getSettlementData(policyHash, agentAddress);
// Write settlement to Sovereign Secret...
chain.markSettled(settlement.toHeight);

// Checkpoint
const checkpoint = chain.getCheckpoint(agentAddress);
// Write checkpoint to Sovereign Secret...
```

---

*Last updated: 2026-03-29 by Claude Opus 4.6*
*Version: 0.1.0 — unified types, chain, skill loader*
