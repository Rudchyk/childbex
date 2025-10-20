import { DataElement } from 'dwv';

/**
 * Return the SOP Instance UID (image ID) for the given slice index.
 *
 * @param meta  one element of app.getMetaData(dataId)   (the JSON you pasted)
 * @param slice zero‑based index of the slice now on screen (0,1,2…)
 */
export function getImageUid(
  meta: Record<string, DataElement>,
  slice = 0
): string | undefined {
  const tag = meta['00080018' as keyof typeof meta]; // (0008,0018) SOP Instance UID
  if (!tag) {
    return;
  }

  if (Array.isArray(tag)) {
    return String(tag);
  }

  const v = tag.value;
  // ─── Single‑slice object: value is just an array ──────────────────────────
  if (Array.isArray(v)) {
    return v[0];
  }

  // ─── Multi‑slice: keyed by "1", "2", … ────────────────────────────────────
  const key = String(slice + 1); // convert 0‑based → 1‑based
  const arr = (v as Record<string, any>)[key];
  return Array.isArray(arr) ? arr[0] : undefined;
}

export function getSeriesDescription(
  meta: Record<string, DataElement>,
  slice = 0
): string | undefined {
  const tag = meta['0008103E' as keyof typeof meta];
  if (!tag) {
    return;
  }

  const v = tag.value;
  // ─── Single‑slice object: value is just an array ──────────────────────────
  if (Array.isArray(v)) {
    return v[0];
  }

  // ─── Multi‑slice: keyed by "1", "2", … ────────────────────────────────────
  const key = String(slice + 1); // convert 0‑based → 1‑based
  const arr = (v as Record<string, any>)[key];
  return Array.isArray(arr) ? arr[0] : undefined;
}
