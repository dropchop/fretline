// Browser APIs the DOM lib doesn't know about yet, and the test hook on window.
interface Navigator {
  /** Audio Session API (Safari). */
  audioSession?: { type: string };
}
interface Window {
  /** Exposed with ?debug for automated browser tests. */
  fretline?: object;
}
