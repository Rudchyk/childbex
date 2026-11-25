/**
 * The document head: the web app manifest is requested with the Cloudflare
 * Access session cookie (a request without it is redirected to the Access
 * login and fails CORS).
 */
import { render } from '@testing-library/react';
import { HeadProvider } from './HeadProvider';

jest.mock('../store/slices', () => ({
  useBase: () => ({ setMeta: jest.fn() }),
}));

describe('HeadProvider', () => {
  it('links the manifest so it is fetched with credentials', () => {
    render(<HeadProvider>{null}</HeadProvider>);

    const links = document.head.querySelectorAll('link[rel="manifest"]');
    expect(links).toHaveLength(1);
    const manifest = links[0];
    expect(manifest.getAttribute('href')).toBe('/manifest.json');
    expect(manifest.getAttribute('crossorigin')).toBe('use-credentials');
  });
});
