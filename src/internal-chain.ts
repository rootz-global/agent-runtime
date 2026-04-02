/**
 * Internal Chain — Unified Append-Only Merkle Ledger
 *
 * ORIGIN: https://rootz.global/public/0x77a6236c6bb22002d5879cc4dae3ae218e58ff76
 * PUBLISHER: 0x3f07D9DE7D4f803d748f254c526Fa6F351e3f8B1
 * LICENSE: BSL-1.1 + Rootz Clause (commercial use: discover@rootz.global)
 * CHAIN: Keep the chain alive.
 *
 * Moved from apps/agent-tee and extended for the unified runtime.
 * Records ALL operations: TEE container ops, wallet ops, and skill events.
 * One chain for the agent's entire life.
 *
 * - Append-only: no delete, no update, no rewrite
 * - Hash-linked: each block references the previous block's hash
 * - Signed: each block is signed by the agent's key
 * - Merkle-rooted: events within a block have a Merkle root
 * - Settleable: ranges of blocks can be flushed to Polygon as one tx
 */

import { ethers } from 'ethers';
import type {
  AgentEvent,
  EventCategory,
  InternalBlock,
  CumulativeState,
  PolicyDecision,
  UnifiedSettlement,
  AgentCheckpoint,
} from './types.js';

const GENESIS_HASH = '0x' + '0'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export class InternalChain {
  private blocks: InternalBlock[] = [];
  private state: CumulativeState;
  private settled: number = 0;
  private checkpointNonce: number = 0;

  constructor(
    private readonly signer: ethers.Wallet | { signMessage(message: string): Promise<string> },
  ) {
    const now = Date.now();
    this.state = {
      totalSigned: 0,
      totalDenied: 0,
      totalValueTransferred: '0',
      dailyValueTransferred: '0',
      weeklyValueTransferred: '0',
      dayStartTimestamp: startOfDay(now),
      weekStartTimestamp: startOfWeek(now),
      secretsCreated: 0,
      notesWritten: 0,
      x402PaymentsMade: 0,
      totalInferenceCalls: 0,
      totalInferenceTokens: 0,
      totalSkillEvents: 0,
      skillCounters: {},
    };
  }

  /** Current chain height */
  get height(): number {
    return this.blocks.length;
  }

  /** Current cumulative state (read-only) */
  get currentState(): Readonly<CumulativeState> {
    return this.state;
  }

  /** Number of unsettled blocks */
  get pendingSettlement(): number {
    return this.blocks.length - this.settled;
  }

  /** Latest block hash */
  get latestHash(): string {
    if (this.blocks.length === 0) return GENESIS_HASH;
    return hashBlock(this.blocks[this.blocks.length - 1]);
  }

  /** Merkle root of all blocks */
  get chainRoot(): string {
    if (this.blocks.length === 0) return GENESIS_HASH;
    const hashes = this.blocks.map(b => hashBlock(b));
    return computeMerkleRoot(hashes);
  }

  /**
   * Record an event on the chain.
   * This is the single entry point for ALL operations — TEE, wallet, and skills.
   */
  async recordEvent(event: Omit<AgentEvent, 'timestamp'>): Promise<number> {
    this.rollOverWindows();

    const fullEvent: AgentEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.updateState(fullEvent);

    const block: InternalBlock = {
      height: this.blocks.length,
      previousHash: this.latestHash,
      events: [fullEvent],
      eventsRoot: hashEvent(fullEvent),
      cumulativeState: { ...this.state },
      timestamp: Date.now(),
      signature: '',
    };

    const blockData = serializeBlockForSigning(block);
    block.signature = await this.signer.signMessage(blockData);

    this.blocks.push(block);
    return block.height;
  }

  /** Convenience: record genesis (policy load) */
  async recordGenesis(policyHash: string): Promise<void> {
    await this.recordEvent({
      category: 'tee_load',
      inputHash: policyHash,
      outputHash: policyHash,
      policyRule: 'genesis',
      decision: 'CONTAINER',
      value: '0',
      counterparty: ethers.ZeroAddress,
      reason: 'Runtime policy loaded',
    });
  }

  /**
   * Get settlement data for unsettled blocks.
   */
  getSettlementData(policyHash: string, agentAddress: string): UnifiedSettlement | null {
    if (this.pendingSettlement === 0) return null;

    const fromHeight = this.settled;
    const toHeight = this.blocks.length - 1;
    const pendingBlocks = this.blocks.slice(fromHeight);

    const hashes = pendingBlocks.map(b => hashBlock(b));
    const merkleRoot = computeMerkleRoot(hashes);

    let eventsCount = 0;
    let totalValue = BigInt(0);
    const skillStats: Record<string, { eventCount: number; [k: string]: unknown }> = {};

    for (const block of pendingBlocks) {
      for (const event of block.events) {
        eventsCount++;
        totalValue += BigInt(event.value);

        if (event.skillId) {
          if (!skillStats[event.skillId]) {
            skillStats[event.skillId] = { eventCount: 0 };
          }
          skillStats[event.skillId].eventCount++;
        }
      }
    }

    return {
      type: 'agent-settlement',
      version: '1.0',
      fromHeight,
      toHeight,
      merkleRoot,
      eventsCount,
      totalValue: totalValue.toString(),
      policyHash,
      stateSnapshot: { ...this.state },
      blocks: pendingBlocks,
      skillStats,
      agentAddress,
      timestamp: new Date().toISOString(),
    };
  }

  /** Mark blocks as settled */
  markSettled(upToHeight: number): void {
    this.settled = upToHeight + 1;
  }

  /** Get checkpoint for state recovery */
  getCheckpoint(agentAddress: string, skillStates: Record<string, string> = {}): AgentCheckpoint {
    this.checkpointNonce++;
    return {
      type: 'agent-checkpoint',
      version: '1.0',
      chainRoot: this.chainRoot,
      chainHeight: this.height,
      settledHeight: this.settled,
      cumulativeState: { ...this.state },
      skillStates,
      timestamp: new Date().toISOString(),
      agentAddress,
      nonce: this.checkpointNonce,
    };
  }

  /** Restore from a checkpoint */
  restoreFromCheckpoint(checkpoint: AgentCheckpoint): void {
    this.state = { ...checkpoint.cumulativeState };
    this.settled = checkpoint.settledHeight;
    this.checkpointNonce = checkpoint.nonce;
  }

  /** Get blocks (for attestation proof) */
  getBlocks(from?: number, to?: number): InternalBlock[] {
    return this.blocks.slice(from ?? 0, to ?? this.blocks.length);
  }

  // ── Private ──────────────────────────────────────────────────

  private updateState(event: AgentEvent): void {
    if (event.decision === 'DENY') {
      this.state.totalDenied++;
      return;
    }

    const valueBI = BigInt(event.value);
    const { category } = event;

    // TEE + wallet counters (existing)
    switch (category) {
      case 'app_sign':
        this.state.totalSigned++;
        this.addValue(valueBI);
        break;
      case 'app_x402_payment':
        this.state.x402PaymentsMade++;
        this.addValue(valueBI);
        break;
      case 'app_create_secret':
        this.state.secretsCreated++;
        break;
      case 'app_write_note':
        this.state.notesWritten++;
        break;
      default:
        break;
    }

    // Skill counters (new)
    if (category.startsWith('skill_')) {
      this.state.totalSkillEvents++;

      if (event.skillId) {
        this.state.skillCounters[event.skillId] =
          (this.state.skillCounters[event.skillId] ?? 0) + 1;
      }

      if (category === 'skill_inference') {
        this.state.totalInferenceCalls++;
        const tokens = (event.meta?.totalTokens as number) ?? 0;
        this.state.totalInferenceTokens += tokens;
      }
    }
  }

  private addValue(valueBI: bigint): void {
    this.state.totalValueTransferred = (BigInt(this.state.totalValueTransferred) + valueBI).toString();
    this.state.dailyValueTransferred = (BigInt(this.state.dailyValueTransferred) + valueBI).toString();
    this.state.weeklyValueTransferred = (BigInt(this.state.weeklyValueTransferred) + valueBI).toString();
  }

  private rollOverWindows(): void {
    const now = Date.now();
    if (now - this.state.dayStartTimestamp >= DAY_MS) {
      this.state.dailyValueTransferred = '0';
      this.state.dayStartTimestamp = startOfDay(now);
    }
    if (now - this.state.weekStartTimestamp >= WEEK_MS) {
      this.state.weeklyValueTransferred = '0';
      this.state.weekStartTimestamp = startOfWeek(now);
    }
  }
}

// ── Hashing Utilities ────────────────────────────────────────────

function hashEvent(event: AgentEvent): string {
  const data = JSON.stringify([
    event.category, event.timestamp, event.inputHash,
    event.outputHash, event.decision, event.value,
  ]);
  return ethers.keccak256(ethers.toUtf8Bytes(data));
}

function hashBlock(block: InternalBlock): string {
  const data = JSON.stringify([
    block.height, block.previousHash,
    block.eventsRoot, block.timestamp,
  ]);
  return ethers.keccak256(ethers.toUtf8Bytes(data));
}

function serializeBlockForSigning(block: InternalBlock): string {
  return JSON.stringify({
    height: block.height,
    previousHash: block.previousHash,
    eventsRoot: block.eventsRoot,
    cumulativeState: block.cumulativeState,
    timestamp: block.timestamp,
  });
}

export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return '0x' + '0'.repeat(64);
  if (hashes.length === 1) return hashes[0];

  const nextLevel: string[] = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i];
    const right = i + 1 < hashes.length ? hashes[i + 1] : left;
    const combined = ethers.keccak256(ethers.concat([
      ethers.getBytes(left),
      ethers.getBytes(right),
    ]));
    nextLevel.push(combined);
  }
  return computeMerkleRoot(nextLevel);
}

function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(timestamp: number): number {
  const d = new Date(timestamp);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
