import { FC, ReactNode } from 'react';
import manifest from '../assets/manifest.json';
import manifestUrl from '../assets/manifest.json?url';

export interface HelmetProviderProps {
  children: ReactNode;
}

/**
 * https://react.dev/reference/react-dom/components/title
 * https://react.dev/reference/react-dom/components/meta
 * https://react.dev/reference/react-dom/components/link
 * https://realfavicongenerator.net/
 * https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#comma-separated-list
 */

export const HeadProvider: FC<HelmetProviderProps> = ({ children }) => {
  return (
    <>
      <title>{manifest.short_name}</title>
      <meta name="description" content={manifest.name} />
      <meta name="theme-color" content={manifest.theme_color} />
      <link rel="icon" type="image/x-icon" href="/favicon.ico" />
      <link rel="shortcut icon" href="/favicon.ico" />
      <link
        rel="icon"
        sizes="96x96"
        type="image/png"
        href="/favicon-96x96.png"
      />
      <link rel="icon" type="image/svg+xml" href="favicon.svg" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-title" content={manifest.short_name} />
      <link rel="manifest" href={manifestUrl} />
      {manifest.icons.map(({ sizes, type, src }) => (
        <link
          key={src + type}
          rel="icon"
          sizes={sizes}
          type={type}
          href={src}
        />
      ))}
      <link rel="canonical" href={window.location.origin} />
      {process.env.NODE_ENV === 'development' && (
        <meta name="robots" content="noindex, nofollow"></meta>
      )}
      {children}
    </>
  );
};

export default HeadProvider;
