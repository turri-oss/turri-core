import type { Conclusion, Notice } from "./notice.ts";

/** The terminal session's inbox. A notice keeps its identity and live state from the session that answers it. */
export interface TerminalNotification {
  title: string;
  detail: string;
  conclusion?: string;
  warning?: boolean;
  notice?: Notice;
  seen: boolean;
}

export class TerminalNotifications {
  readonly items: TerminalNotification[] = [];
  private readonly reviews = new Map<string, TerminalNotification>();

  get count(): number {
    return this.items.filter((item) => !item.seen || this.needsAnswer(item)).length;
  }

  needsAnswer(item: TerminalNotification): boolean {
    return item.notice?.state === "open" && item.notice.kind !== "fixed";
  }

  add(title: string, detail: string, options: Pick<TerminalNotification, "notice" | "warning"> = {}): void {
    this.items.unshift({ title, detail, seen: false, ...options });
  }

  /** Only the sentinel's review shares a row. The pulse result and the question whether to start it are independent. */
  private review(about: { job?: string; check?: string }, title: string): TerminalNotification {
    const key = about.check ? `check:${about.check}` : about.job ? `pulse:${about.job}` : undefined;
    const known = key && this.reviews.get(key);
    if (known) return known;
    const item = { title, detail: "", seen: false };
    this.items.unshift(item);
    if (key) this.reviews.set(key, item);
    return item;
  }

  put(notice: Notice, work?: Pick<Conclusion, "job" | "check">): void {
    const about = [notice.module, notice.pulse !== undefined ? `pulse ${notice.pulse}` : undefined].filter(Boolean).join(" · ");
    const heading = notice.kind === "fixed" ? "Fixed" : "Sentinel";
    const title = [heading, about, notice.summary].filter(Boolean).join(" · ");
    const detail = notice.evidence.join("\n\n");
    if (notice.kind === "sentinel-start") return this.add(title, detail, { notice });
    const item = this.review(work ?? notice, title);
    if (!item.conclusion) item.warning = notice.severity !== "info";
    Object.assign(item, { title, detail, notice, seen: false });
  }

  concluded(result: Conclusion): void {
    const what = result.pulse !== undefined ? `pulse ${result.pulse}` : result.job ?? result.check;
    const verdict = result.verdict === "holds" ? "it holds" : result.verdict === "wrong" ? "found something wrong" : "not checked";
    const item = this.review(result, ["Sentinel", result.module, what, verdict].filter(Boolean).join(" · "));
    item.conclusion = `${verdict}: ${result.summary}`;
    item.warning = result.verdict !== "holds";
  }
}
