import slug from 'slug';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
import { isHasCyrillic } from 'cyrillic-doctor';

export function toSlugIfCyr(str: string) {
  return isHasCyrillic(str) ? slug(str) : slug(str, { lower: true });
}
