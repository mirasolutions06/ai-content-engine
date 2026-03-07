import { continueRender, delayRender } from 'remotion';
import { resolveSrc } from './resolve-src.js';

/**
 * Loads a custom font from the project's brand folder into the Remotion browser context.
 * Must be called at the top level of a composition component (not inside useEffect or conditionals).
 * Falls back gracefully if the font file is missing — the composition renders with system fonts.
 *
 * @param fontPath - Path to the .ttf font file (will be passed through staticFile())
 * @param fontFamily - CSS font-family name to register
 * @param weight - CSS font weight ('400' for regular, '700' for bold)
 */
export function loadProjectFont(
  fontPath: string | undefined,
  fontFamily: string,
  weight: '400' | '700',
): void {
  if (!fontPath) return;

  const handle = delayRender(`Loading font: ${fontFamily} ${weight}`);

  const font = new FontFace(fontFamily, `url(${resolveSrc(fontPath)})`, {
    weight,
    style: 'normal',
  });

  font.load().then(() => {
    // FontFaceSet.add() exists at runtime but is missing from this version of the
    // TypeScript DOM lib types — cast to the Set interface to satisfy the compiler.
    (document.fonts as unknown as Set<FontFace>).add(font);
    continueRender(handle);
  }).catch(() => {
    // Font failed to load — fall back silently, composition still renders
    continueRender(handle);
  });
}
