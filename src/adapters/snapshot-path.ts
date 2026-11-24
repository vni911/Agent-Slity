import { basename } from "node:path";

/** 내부 경로 정책이며 public index에서 노출하지 않는다. */
export function isSafeSnapshotPath(path: unknown, platform: string = process.platform): path is string {
  if (typeof path !== "string" || !path.trim() || path.includes("\0") || /[\\/]$/.test(path)) return false;
  if (platform === "win32") {
    if (/^[\\/]{2}/.test(path) || /^[A-Za-z]:(?![\\/])/.test(path)) return false;
    const rest = /^[A-Za-z]:/.test(path) ? path.slice(2) : path;
    if (/[<>:"|?*\x00-\x1f]/.test(rest)) return false;
    if (rest.split(/[\\/]/).some(part => /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:[ .].*)?$/i.test(part.replace(/[ .]+$/, "")))) return false;
  }
  return ![".", "..", ""].includes(basename(path));
}
