import { toSlugIfCyr } from './toSlugIfCyr.js';

describe('libsHelpers', () => {
  it('should work', () => {
    expect(toSlugIfCyr('boo')).toEqual('boo');
  });
});
