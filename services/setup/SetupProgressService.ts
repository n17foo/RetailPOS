/**
 * SetupProgressService
 *
 * Tracks which onboarding phases have been completed and which optional
 * feature setup tasks have been deferred to More → Settings.
 *
 * Persisted to key-value store under the key `setup.progress`.
 * Used by MoreMenuComposer to surface "Finish setup" callouts and by
 * OnboardingProvider to record phase completion.
 */

import { keyValueRepository } from '../../repositories/KeyValueRepository';
import { LoggerFactory } from '../logger/LoggerFactory';

const SETUP_PROGRESS_KEY = 'setup.progress';

export interface SetupPhases {
  platform: boolean;
  user: boolean;
  peripherals: boolean;
}

export interface SetupProgress {
  onboardingComplete: boolean;
  completedPhases: SetupPhases;
  /** Keys of feature setup tasks the user explicitly deferred */
  deferredFeatures: string[];
  updatedAt: number;
}

const DEFAULT_PROGRESS: SetupProgress = {
  onboardingComplete: false,
  completedPhases: { platform: false, user: false, peripherals: false },
  deferredFeatures: [],
  updatedAt: 0,
};

export class SetupProgressService {
  private static instance: SetupProgressService;
  private logger = LoggerFactory.getInstance().createLogger('SetupProgressService');
  private cached: SetupProgress | null = null;

  private constructor() {}

  public static getInstance(): SetupProgressService {
    if (!SetupProgressService.instance) {
      SetupProgressService.instance = new SetupProgressService();
    }
    return SetupProgressService.instance;
  }

  /** Load progress from storage. Safe to call multiple times. */
  public async load(): Promise<SetupProgress> {
    try {
      const stored = await keyValueRepository.getObject<SetupProgress>(SETUP_PROGRESS_KEY);
      this.cached = stored ?? { ...DEFAULT_PROGRESS };
    } catch (err) {
      this.logger.warn({ message: 'Failed to load setup progress, using defaults', ...(err as Record<string, unknown>) });
      this.cached = { ...DEFAULT_PROGRESS };
    }
    return this.cached;
  }

  /** Current in-memory progress (call load() first). */
  public get(): SetupProgress {
    return this.cached ?? { ...DEFAULT_PROGRESS };
  }

  /** Mark a specific onboarding phase as complete and persist. */
  public async completePhase(phase: keyof SetupPhases): Promise<void> {
    const progress = this.get();
    progress.completedPhases[phase] = true;
    progress.updatedAt = Date.now();
    await this.save(progress);
  }

  /** Mark onboarding as fully complete and persist. */
  public async markOnboardingComplete(deferredFeatures: string[] = []): Promise<void> {
    const progress = this.get();
    progress.onboardingComplete = true;
    progress.completedPhases = { platform: true, user: true, peripherals: true };
    progress.deferredFeatures = deferredFeatures;
    progress.updatedAt = Date.now();
    await this.save(progress);
  }

  /** Add a feature key to the deferred list (idempotent). */
  public async deferFeature(featureKey: string): Promise<void> {
    const progress = this.get();
    if (!progress.deferredFeatures.includes(featureKey)) {
      progress.deferredFeatures = [...progress.deferredFeatures, featureKey];
      progress.updatedAt = Date.now();
      await this.save(progress);
    }
  }

  /** Remove a feature key from the deferred list (marks it as set up). */
  public async completeFeatureSetup(featureKey: string): Promise<void> {
    const progress = this.get();
    progress.deferredFeatures = progress.deferredFeatures.filter(k => k !== featureKey);
    progress.updatedAt = Date.now();
    await this.save(progress);
  }

  /** True when there are pending deferred setup tasks. */
  public hasDeferredSetup(): boolean {
    return this.get().deferredFeatures.length > 0;
  }

  private async save(progress: SetupProgress): Promise<void> {
    try {
      this.cached = progress;
      await keyValueRepository.setObject(SETUP_PROGRESS_KEY, progress);
    } catch (err) {
      this.logger.error({ message: 'Failed to persist setup progress' }, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** Convenience singleton export */
export const setupProgressService = SetupProgressService.getInstance();
