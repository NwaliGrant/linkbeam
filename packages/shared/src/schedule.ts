export interface Schedulable {
  enabled: boolean;
  starts_at: number | null;
  ends_at: number | null;
}

/** Whether visitors can see a link at this moment. Same rule the public page uses: starts at or before now, ends after now. */
export function isLiveAt(link: Schedulable, nowSeconds: number): boolean {
  if (!link.enabled) return false;
  if (link.starts_at !== null && link.starts_at > nowSeconds) return false;
  if (link.ends_at !== null && link.ends_at <= nowSeconds) return false;
  return true;
}
