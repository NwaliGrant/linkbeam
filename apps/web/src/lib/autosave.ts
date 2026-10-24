export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveOptions {
  /** Wait this long after the last change of a field before sending it. */
  delay: number;
  onStatus: (status: SaveStatus, message?: string) => void;
  /** Tests replace these. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

type Job = () => Promise<void>;

/**
 * Keeps edits from being lost and tells the person what is happening.
 * A later change to the same key replaces the waiting one, so typing sends one request, not one per letter.
 * Jobs for different keys run side by side. Failed jobs are kept so "Try again" can resend them.
 */
export function createAutosave(options: AutosaveOptions) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const waiting = new Map<string, { job: Job; timer: unknown }>();
  const failed = new Map<string, Job>();
  let running = 0;
  let lastError = "";

  const refresh = (): void => {
    if (waiting.size > 0 || running > 0) options.onStatus("saving");
    else if (failed.size > 0) options.onStatus("error", lastError);
    else options.onStatus("saved");
  };

  const run = async (key: string, job: Job): Promise<void> => {
    running += 1;
    failed.delete(key);
    refresh();
    try {
      await job();
    } catch (error) {
      failed.set(key, job);
      lastError = error instanceof Error ? error.message : "Something went wrong.";
    } finally {
      running -= 1;
      refresh();
    }
  };

  return {
    schedule(key: string, job: Job, immediate = false): void {
      const previous = waiting.get(key);
      if (previous) clearTimer(previous.timer);
      failed.delete(key);
      if (immediate) {
        waiting.delete(key);
        void run(key, job);
        return;
      }
      const timer = setTimer(() => {
        waiting.delete(key);
        void run(key, job);
      }, options.delay);
      waiting.set(key, { job, timer });
      refresh();
    },
    /** Drops anything waiting or failed for a key, for example when its link was deleted. */
    cancel(key: string): void {
      const previous = waiting.get(key);
      if (previous) clearTimer(previous.timer);
      waiting.delete(key);
      failed.delete(key);
      refresh();
    },
    /** Sends everything that is waiting now. */
    async flush(): Promise<void> {
      const jobs = [...waiting.entries()];
      for (const [, { timer }] of jobs) clearTimer(timer);
      waiting.clear();
      await Promise.all(jobs.map(([key, { job }]) => run(key, job)));
    },
    async retry(): Promise<void> {
      const jobs = [...failed.entries()];
      await Promise.all(jobs.map(([key, job]) => run(key, job)));
    },
    hasUnsaved: (): boolean => waiting.size > 0 || failed.size > 0 || running > 0,
  };
}
