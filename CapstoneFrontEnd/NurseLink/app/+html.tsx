import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Custom web document (Expo's default is identical except for the script
 * below). Needed because of a well-known mobile Safari bug: react-native-web
 * injects its real stylesheet via JS *after* the first HTML paint, so if
 * that first paint is ever wider than the screen for an instant (which it
 * reliably is here, since unstyled <div>s stack instead of using flex),
 * Safari permanently locks its zoom level to fit that first wide frame —
 * even once React Native Web's layout corrects itself a moment later, the
 * page stays visually zoomed in until the user manually double-taps to
 * reset zoom. This forces that same recalculation automatically, once,
 * right after the real layout has settled.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function resetZoom() {
                  var viewport = document.querySelector('meta[name=viewport]');
                  if (!viewport) return;
                  var original = viewport.getAttribute('content');
                  viewport.setAttribute('content', original + ', maximum-scale=1');
                  requestAnimationFrame(function () {
                    viewport.setAttribute('content', original);
                  });
                }
                if (document.readyState === 'complete') {
                  setTimeout(resetZoom, 50);
                } else {
                  window.addEventListener('load', function () {
                    setTimeout(resetZoom, 50);
                  });
                }
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
