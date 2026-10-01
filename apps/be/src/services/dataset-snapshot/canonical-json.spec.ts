import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './canonical-json';
import { compareItems, comparePatients, manifestSha256, type DatasetManifestV1 } from './export';

/**
 * Shared with the Python side (apps/ml tests/dataset/test_manifest.py):
 * the same unsorted, pretty-printed manifest must give the same hash.
 */
export const GOLDEN_MANIFEST_SHA256 = 'c05a73e04eba3b3343f22a9f4246b5af405b959d0818538133db063b720a943a';
const goldenPath = path.resolve(__dirname, '../../../../ml/tests/fixtures/manifest-golden.json');

const golden = (): DatasetManifestV1 => JSON.parse(readFileSync(goldenPath, 'utf8'));

describe('canonicalJson', () => {
  it('sorts keys, drops whitespace and writes integral numbers as integers', () => {
    expect(canonicalJson({ b: [1.0, 0.15, -0, 'ü\n'], a: { d: null, c: true } })).toBe(
      '{"a":{"c":true,"d":null},"b":[1,0.15,0,"ü\\n"]}'
    );
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [1e-7], [2 ** 60], [undefined], [{ a: undefined }], [() => 1]])(
    'rejects %p',
    (value) => {
      expect(() => canonicalJson(value)).toThrow();
    }
  );
});

describe('manifest canonical order and hash (golden vector shared with Python)', () => {
  it('reordered input arrays hash identically once canonically ordered', () => {
    const manifest = golden();
    manifest.patients.sort(comparePatients);
    manifest.items.sort(compareItems);
    expect(manifest.items.map((item) => item.patientImageId.slice(-1))).toEqual(['1', '2', '3', '4', '5']);
    expect(manifest.patients.map((patient) => patient.split)).toEqual(['TRAIN', 'VALIDATION', 'TEST']);
    expect(manifestSha256(manifest)).toBe(GOLDEN_MANIFEST_SHA256);

    const reversed = golden();
    reversed.items.reverse();
    reversed.patients.reverse();
    reversed.items.sort(compareItems);
    reversed.patients.sort(comparePatients);
    expect(manifestSha256(reversed)).toBe(GOLDEN_MANIFEST_SHA256);
  });

  it('any semantic change changes the hash', () => {
    const manifest = golden();
    manifest.patients.sort(comparePatients);
    manifest.items.sort(compareItems);
    manifest.items[0].fileSha256 = 'f'.repeat(64);
    expect(manifestSha256(manifest)).not.toBe(GOLDEN_MANIFEST_SHA256);
  });
});
