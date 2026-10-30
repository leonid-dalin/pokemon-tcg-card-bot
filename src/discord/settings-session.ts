/**
 * Bounded in-memory store for open settings panels. Sessions hold no personal
 * data beyond the owner id; expiry discards only unsaved navigation state.
 */
export interface SettingsSession {
  id: string;
  ownerId: string;
  guildId: string | null;
  screen: "overview" | "replies" | "channels" | "games" | "currency" | "personal";
  scope: "personal" | "server";
  /** Selected channel ids pending Save, only while on the channels screen. */
  draftChannelIds?: string[];
  /** The stored values this screen was rendered from, for conflict detection. */
  baseline: string;
  createdAt: number;
  expiresAt: number;
}

const MAX_SESSIONS = 500;
const LIFETIME_MS = 10 * 60_000;

export class SettingsSessions {
  private readonly sessions = new Map<string, SettingsSession>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.sessions.size;
  }

  /** Creates a panel session owned by the clicking member. */
  open(ownerId: string, guildId: string | null, scope: "personal" | "server", screen: SettingsSession["screen"], baseline: string): SettingsSession {
    this.prune();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (oldest) this.sessions.delete(oldest.id);
    }
    const id = `${ownerId}:${this.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}`;
    const session: SettingsSession = {
      id,
      ownerId,
      guildId,
      screen,
      scope,
      baseline,
      createdAt: this.now(),
      expiresAt: this.now() + LIFETIME_MS,
    };
    this.sessions.set(id, session);
    return session;
  }

  /**
   * Returns the session only when it is live and owned by the member presenting
   * the component id. A component id alone is never authorisation.
   */
  resolve(sessionId: string, ownerId: string): SettingsSession | undefined {
    this.prune();
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) return undefined;
    return session;
  }

  update(session: SettingsSession): void {
    session.expiresAt = this.now() + LIFETIME_MS;
    this.sessions.set(session.id, session);
  }

  close(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}
