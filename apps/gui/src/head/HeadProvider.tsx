import { FC, ReactNode } from 'react';
import manifest from '../assets/manifest.json';

export interface HelmetProviderProps {
  children: ReactNode;
}

/**
 * https://react.dev/reference/react-dom/components/title
 * https://react.dev/reference/react-dom/components/meta
 * https://react.dev/reference/react-dom/components/link
 * TODO: add robots
 * https://realfavicongenerator.net/
 * manifest
 */

export const HeadProvider: FC<HelmetProviderProps> = ({ children }) => {
  return (
    <>
      <title>{manifest.short_name}</title>
      <meta name="description" content={manifest.name} />
      <meta name="theme-color" content={manifest.theme_color} />
      <link rel="icon" type="image/x-icon" href="favicon.ico" />
      <link
        rel="icon"
        sizes="96x96"
        type="image/png"
        href="/favicon-96x96.png"
      />
      <link rel="icon" type="image/svg+xml" href="favicon.svg" />
      <link rel="apple-touch-icon" href="apple-touch-icon.png" />
      <link rel="manifest" href="manifest.json" />
      {manifest.icons.map(({ sizes, type, src }) => (
        <link rel="icon" sizes={sizes} type={type} href={src} />
      ))}
      <link rel="canonical" href={window.location.origin} />
      {children}
    </>
  );
};

export default HeadProvider;
