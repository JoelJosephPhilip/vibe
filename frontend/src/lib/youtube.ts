/**
 * Loads the YouTube IFrame API once and reuses it for every player on the
 * page. Chains onto any onYouTubeIframeAPIReady callback set by someone else
 * (components/video.tsx sets its own) so the two never clobber each other.
 */
let loadPromise: Promise<NonNullable<Window['YT']>> | null = null;

export function loadYouTubeIframeApi(): Promise<NonNullable<Window['YT']>> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve(window.YT!);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return loadPromise;
}
