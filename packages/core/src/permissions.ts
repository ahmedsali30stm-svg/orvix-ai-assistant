import type { RiskLevel, PermissionLevel } from "@jarvis/schemas";

// ── Permission engine (blueprint §24, §71) ────────────────────────────────

const RISK_TO_LEVEL: Record<RiskLevel, PermissionLevel> = {
  read: 1,
  safe_write: 2,
  external_write: 3,
  critical: 4,
};

export interface PermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface PermissionPolicy {
  /** Level 1 (read) actions run without asking. */
  allowRead: boolean;
  /** Level 2 (safe internal writes: drafts, internal tasks, reports) run without asking. */
  allowSafeWrite: boolean;
  /** Level 3 (external writes: sends, publishes) require explicit approval. */
  approveExternalWrite: boolean;
  /** Level 4 (payments, deletions, destructive commands) require explicit approval. */
  approveCritical: boolean;
  /** Bulk thresholds that escalate to approval regardless of base risk. */
  bulk: { emailRecipients: number; whatsappMessages: number; recordDeletes: number };
}

export const DEFAULT_POLICY: PermissionPolicy = {
  allowRead: true,
  allowSafeWrite: true,
  approveExternalWrite: true,
  approveCritical: true,
  bulk: { emailRecipients: 10, whatsappMessages: 10, recordDeletes: 5 },
};

export class PermissionEngine {
  /**
   * Targets (URLs / app names) that computer.open may launch WITHOUT asking.
   * Managed at runtime via setAlwaysAllowed / removeAlwaysAllowed. Match is
   * hostname-level for URLs (youtube.com covers all its pages) and exact-ish
   * for app names.
   */
  private alwaysAllowed = new Set<string>();

  constructor(private policy: PermissionPolicy = DEFAULT_POLICY) {}

  setAlwaysAllowed(targets: string[]): void {
    this.alwaysAllowed = new Set(targets.map((t) => normalizeTarget(t)).filter(Boolean));
  }

  listAlwaysAllowed(): string[] {
    return [...this.alwaysAllowed];
  }

  isAlwaysAllowed(target: string): boolean {
    const norm = normalizeTarget(target);
    if (!norm) return false;
    for (const allowed of this.alwaysAllowed) {
      if (norm === allowed) return true;
      // hostname suffix match: music.youtube.com matches youtube.com
      if (norm.endsWith("." + allowed)) return true;
    }
    return false;
  }

  decide(risk: RiskLevel, opts?: { bulkCount?: number; bulkKind?: keyof PermissionPolicy["bulk"] }): PermissionDecision {
    if (opts?.bulkCount != null && opts.bulkKind) {
      const threshold = this.policy.bulk[opts.bulkKind];
      if (opts.bulkCount > threshold) {
        return {
          allowed: true,
          requiresApproval: true,
          reason: `Bulk action (${opts.bulkCount}) exceeds threshold ${threshold} — approval required`,
        };
      }
    }
    switch (risk) {
      case "read":
        return { allowed: this.policy.allowRead, requiresApproval: false, reason: "read-only" };
      case "safe_write":
        return { allowed: this.policy.allowSafeWrite, requiresApproval: false, reason: "safe internal write" };
      case "external_write":
        return { allowed: true, requiresApproval: this.policy.approveExternalWrite, reason: "external communication" };
      case "critical":
        return { allowed: true, requiresApproval: this.policy.approveCritical, reason: "critical action" };
    }
  }
}

/** youtube.com, https://www.youtube.com/watch → youtube.com ; Chrome → chrome */
export function normalizeTarget(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  // App/file names are handled before URL parsing: "chrome.exe" is not a host.
  if (/\.(exe|app|lnk|bat|cmd)$/i.test(s)) return s.replace(/\.(exe|app|lnk|bat|cmd)$/i, "");
  if (!s.includes(".") && !s.includes(":")) return s.replace(/[^a-z0-9 _-]/g, "").trim();
  try {
    const url = s.startsWith("http") ? new URL(s) : new URL(`https://${s}`);
    const host = url.hostname.replace(/^www\./, "");
    // A real domain has a known TLD shape (no slashes, one dot separating parts).
    if (host.includes(".") && !host.endsWith(".exe")) return host;
  } catch {
    // not a URL — fall through to app-name handling
  }
  return s.replace(/[^a-z0-9. _-]/g, "").trim();
}
