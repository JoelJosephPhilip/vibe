// models.ts pulls in class-transformer decorators, which need the metadata
// polyfill loaded first — same first line as every other suite here.
import 'reflect-metadata';
import {describe, expect, it} from 'vitest';
import {
  isUniversalProctoringActive,
  resolveProctoringEnabled,
} from '#root/shared/interfaces/models.js';
import {ProctoringComponent} from '#root/shared/database/interfaces/ISettingRepository.js';

/**
 * Guards the item > module > universal precedence that lets selective
 * proctoring ship without migrating existing content: every item/module
 * written before this feature existed has no override field at all, so the
 * "undefined falls through to the next tier" behavior below is what keeps
 * their proctoring status unchanged after deploy.
 */
describe('resolveProctoringEnabled', () => {
  const universalOn = {
    settings: {
      proctors: {
        detectors: [
          {
            detectorName: ProctoringComponent.CAMERAMICRO,
            settings: {enabled: true},
          },
        ],
      },
    },
  };
  const universalOff = {
    settings: {
      proctors: {
        detectors: [
          {
            detectorName: ProctoringComponent.CAMERAMICRO,
            settings: {enabled: false},
          },
        ],
      },
    },
  };

  it('universal on, no overrides -> proctored', () => {
    expect(resolveProctoringEnabled(undefined, undefined, universalOn)).toBe(
      true,
    );
  });

  it('universal off, no overrides -> not proctored', () => {
    expect(resolveProctoringEnabled(undefined, undefined, universalOff)).toBe(
      false,
    );
  });

  it('universal off, item override true -> proctored (selective enable)', () => {
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: true},
        undefined,
        universalOff,
      ),
    ).toBe(true);
  });

  it('universal on, item override false -> not proctored (selective exception)', () => {
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: false},
        undefined,
        universalOn,
      ),
    ).toBe(false);
  });

  it('module override true, item unset, universal off -> proctored (module tier applies)', () => {
    expect(
      resolveProctoringEnabled(
        undefined,
        {proctoringEnabled: true},
        universalOff,
      ),
    ).toBe(true);
  });

  it('module override false, item unset, universal on -> not proctored (module tier applies)', () => {
    expect(
      resolveProctoringEnabled(
        undefined,
        {proctoringEnabled: false},
        universalOn,
      ),
    ).toBe(false);
  });

  it('item override wins over a conflicting module override, which wins over universal', () => {
    // All three tiers disagree; item must win.
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: true},
        {proctoringEnabled: false},
        universalOff,
      ),
    ).toBe(true);
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: false},
        {proctoringEnabled: true},
        universalOn,
      ),
    ).toBe(false);
  });

  it('a legacy item/module with no field at all resolves exactly like undefined', () => {
    expect(resolveProctoringEnabled({}, {}, universalOn)).toBe(true);
    expect(resolveProctoringEnabled({}, {}, universalOff)).toBe(false);
  });

  it('a stored `null` (how Mongo serializes a never-set optional field on insert) is treated as unset, not as an explicit false', () => {
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: null},
        {proctoringEnabled: null},
        universalOn,
      ),
    ).toBe(true);
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: null},
        {proctoringEnabled: null},
        universalOff,
      ),
    ).toBe(false);
    // Module still applies when only the item is null.
    expect(
      resolveProctoringEnabled(
        {proctoringEnabled: null},
        {proctoringEnabled: true},
        universalOff,
      ),
    ).toBe(true);
  });

  it('missing course settings entirely defaults to not proctored', () => {
    expect(resolveProctoringEnabled(undefined, undefined, undefined)).toBe(
      false,
    );
  });
});

describe('isUniversalProctoringActive', () => {
  it('is false when every detector is disabled (the default for every new course)', () => {
    expect(
      isUniversalProctoringActive({
        detectors: [
          {
            detectorName: ProctoringComponent.CAMERAMICRO,
            settings: {enabled: false},
          },
          {
            detectorName: ProctoringComponent.BLURDETECTION,
            settings: {enabled: false},
          },
        ],
      }),
    ).toBe(false);
  });

  it('is true when at least one detector is enabled', () => {
    expect(
      isUniversalProctoringActive({
        detectors: [
          {
            detectorName: ProctoringComponent.CAMERAMICRO,
            settings: {enabled: false},
          },
          {
            detectorName: ProctoringComponent.FACERECOGNITION,
            settings: {enabled: true},
          },
        ],
      }),
    ).toBe(true);
  });

  it('is false for an empty or missing detector list', () => {
    expect(isUniversalProctoringActive({detectors: []})).toBe(false);
    expect(isUniversalProctoringActive(undefined)).toBe(false);
  });
});
