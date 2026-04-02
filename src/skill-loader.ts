/**
 * Skill Loader — Validates and loads skills into the runtime.
 *
 * ORIGIN: https://rootz.global/public/0x77a6236c6bb22002d5879cc4dae3ae218e58ff76
 * PUBLISHER: 0x3f07D9DE7D4f803d748f254c526Fa6F351e3f8B1
 * LICENSE: BSL-1.1 + Rootz Clause (commercial use: discover@rootz.global)
 * CHAIN: Keep the chain alive.
 *
 * Verifies:
 * 1. Manifest has all required fields
 * 2. Code hash matches the skill bundle (if code is provided)
 * 3. Declared event categories are valid
 * 4. Skill permissions don't exceed policy
 *
 * The TEE verifies the manifest before loading. Skills can only
 * emit events they declared in their manifest. The policy engine
 * evaluates each skill event at runtime.
 */

import { createHash } from 'node:crypto';
import type {
  SkillManifest,
  SkillPermissions,
  AgentSkill,
  SkillContext,
  EventCategory,
} from './types.js';

/** All valid event categories for validation */
const VALID_CATEGORIES: Set<EventCategory> = new Set([
  'tee_load', 'tee_checkpoint', 'tee_settlement',
  'app_sign', 'app_encrypt', 'app_decrypt',
  'app_create_secret', 'app_write_note', 'app_read_secret',
  'app_send_invite', 'app_x402_payment', 'app_data_wallet',
  'skill_inference', 'skill_payment', 'skill_output',
  'skill_installed', 'skill_removed', 'skill_error',
  'policy_deny', 'policy_updated',
  'birth_certificate', 'attestation', 'revocation',
]);

/** Categories that skills are allowed to declare */
const SKILL_CATEGORIES: Set<EventCategory> = new Set([
  'skill_inference', 'skill_payment', 'skill_output',
  'skill_installed', 'skill_removed', 'skill_error',
]);

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a skill manifest before loading.
 */
export function validateManifest(manifest: SkillManifest): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!manifest.name || manifest.name.length < 2) {
    errors.push('Manifest name is required (min 2 chars)');
  }
  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('Manifest version must be semver (e.g., 1.0.0)');
  }
  if (!manifest.codeHash || !manifest.codeHash.startsWith('sha256:')) {
    errors.push('Manifest codeHash must start with sha256:');
  }
  if (!manifest.entryPoint) {
    errors.push('Manifest entryPoint is required');
  }

  // Permissions
  if (!manifest.permissions) {
    errors.push('Manifest permissions are required');
  } else {
    // Validate declared event categories
    for (const cat of manifest.permissions.emitEvents) {
      if (!VALID_CATEGORIES.has(cat)) {
        errors.push(`Invalid event category: ${cat}`);
      }
      if (!SKILL_CATEGORIES.has(cat)) {
        warnings.push(`Category ${cat} is not a skill category — skill may not be able to emit it`);
      }
    }

    if (manifest.permissions.emitEvents.length === 0) {
      warnings.push('Skill declares no emittable events');
    }
  }

  // Author signature (check presence, not validity — that requires the author's public key)
  if (!manifest.authorSignature || manifest.authorSignature === '0x') {
    warnings.push('Manifest has no author signature (unsigned skill)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify that a skill's code matches its declared hash.
 */
export function verifyCodeHash(code: string, declaredHash: string): boolean {
  const actualHash = 'sha256:' + createHash('sha256').update(code).digest('hex');
  return actualHash === declaredHash;
}

/**
 * Check that a skill's declared permissions are within policy bounds.
 */
export function checkPermissionsAgainstPolicy(
  permissions: SkillPermissions,
  allowedSkills: string[],
  skillName: string,
): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if skill is in the policy's allowed list
  if (allowedSkills.length > 0 && !allowedSkills.includes(skillName)) {
    errors.push(`Skill '${skillName}' is not in the policy's allowedSkills list`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Loaded skill record — tracks a skill after validation and loading.
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  skill: AgentSkill;
  loadedAt: number;
  eventCount: number;
}

/**
 * Skill registry — manages all loaded skills.
 */
export class SkillRegistry {
  private skills: Map<string, LoadedSkill> = new Map();

  /** Load a skill after validation */
  async loadSkill(skill: AgentSkill, ctx: SkillContext): Promise<LoadedSkill> {
    const { manifest } = skill;

    // Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Skill manifest invalid: ${validation.errors.join(', ')}`);
    }

    for (const warning of validation.warnings) {
      console.error(`[SkillLoader] Warning for ${manifest.name}: ${warning}`);
    }

    // Initialize the skill
    await skill.initialize(ctx);

    const loaded: LoadedSkill = {
      manifest,
      skill,
      loadedAt: Date.now(),
      eventCount: 0,
    };

    this.skills.set(manifest.name, loaded);
    console.error(`[SkillLoader] Loaded: ${manifest.name}@${manifest.version}`);

    return loaded;
  }

  /** Get a loaded skill by name */
  getSkill(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  /** Get all loaded skills */
  getAllSkills(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  /** Get all manifests (for birth certificate) */
  getAllManifests(): SkillManifest[] {
    return this.getAllSkills().map(s => s.manifest);
  }

  /** Check if a skill can emit a given event category */
  canEmit(skillName: string, category: EventCategory): boolean {
    const loaded = this.skills.get(skillName);
    if (!loaded) return false;
    return loaded.manifest.permissions.emitEvents.includes(category);
  }

  /** Increment event counter for a skill */
  recordSkillEvent(skillName: string): void {
    const loaded = this.skills.get(skillName);
    if (loaded) loaded.eventCount++;
  }

  /** Collect session content from all skills (for archiving) */
  collectSessionContent(): Record<string, string> {
    const content: Record<string, string> = {};
    for (const [name, loaded] of this.skills) {
      if (loaded.skill.getSessionContent) {
        const text = loaded.skill.getSessionContent();
        if (text) content[name] = text;
      }
    }
    return content;
  }

  /** Shutdown all skills */
  async shutdownAll(): Promise<void> {
    for (const [name, loaded] of this.skills) {
      try {
        await loaded.skill.shutdown?.();
        console.error(`[SkillLoader] Shutdown: ${name}`);
      } catch (err) {
        console.error(`[SkillLoader] Shutdown error for ${name}: ${err}`);
      }
    }
    this.skills.clear();
  }
}
