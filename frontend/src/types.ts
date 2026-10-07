// API response types — mirror what the Lume server emits.

export interface RepoView {
  name: string;
  full_name: string;
  lang: string;
  stars: number;
  forks: number;
  issues: number;
  is_fork: boolean;
  archived: boolean;
  license: string;
  desc: string;
  url: string;
  topics: string[];
  created: string;
  updated: string;
  pushed: string;
  created_year: number;
  days_since_push: number;
  days_since_updated: number;
  recency: "active" | "recent" | "dormant" | "stale" | "unknown";
  size: number;
  push_month?: string;
}

export interface Overview {
  owner: string;
  fetched_at: string;
  profile: {
    login?: string;
    name?: string;
    avatar_url?: string;
    bio?: string;
    company?: string;
    location?: string;
    blog?: string;
    twitter_username?: string;
    hireable?: boolean;
    followers?: number;
    following?: number;
    public_repos?: number;
    public_gists?: number;
    created_at?: string;
    html_url?: string;
    /** most recent pushed_at across the owner's repos (live fetch only) — cross-check for the hireable flag */
    last_push?: string;
  };
  count: number;
  non_fork_count: number;
  totals: {
    stars: number;
    forks: number;
    issues: number;
    archived: number;
    forked: number;
  };
  languages: Record<string, number>;
  recency: Record<string, number>;
  years: Record<string, number>;
  top_by_stars: RepoView[];
  top_by_activity: RepoView[];
  // raw counters the dashboard turns into talent-signal percentages
  talent?: {
    with_desc: number;
    with_license: number;
    with_topics: number;
    avg_days_since_push: number;
  };
  // "YYYY-MM" -> how many repos were last pushed that month (activity trend)
  push_trend?: Record<string, number>;
}

// HR / recruiter-oriented view derived from an Overview.
export interface TalentSignals {
  member_since_year: number | null;
  tenure_years: number | null;
  output_ratio: number;      // active(≤90d) / total
  avg_days_since_push: number;
  desc_ratio: number;        // repos with a description
  license_ratio: number;     // repos with a license
  topics_ratio: number;      // repos with topics
  top_lang: string;
  top_lang_ratio: number;
  top2_ratio: number;        // primary + secondary language share (cross-stack, not scattered)
  recent_active_ratio: number; // share of original repos pushed within 90d ("recent")
  secondary_langs: string[];
  followers: number;
  top_star_repo: { name: string; stars: number } | null;
  labels: string[];
}

export interface RepoPage {
  offset: number;
  limit: number;
  total: number;
  count: number;
  repos: RepoView[];
}

export interface SearchResult {
  owner: string;
  q: string;
  total: number;
  shown: RepoView[];
}

export interface PersonView {
  login: string;
  name: string;
  avatar?: string;
  url: string;
  type: string;
  /** water-account pre-screen level from suspects.json ("high" | "medium") */
  suspect?: string;
  /** login name carries recruiter/HR vocabulary — likely a hiring-side account */
  recruiter?: boolean;
  /** API-confirmation evidence (followers/repos/created/note), when a confirmation round has run */
  api?: {
    followers: number;
    repos: number;
    created: string;
    note: string;
    confirmed?: string;
  };
  /** talent-radar influence score from scores.json (0 when not scored yet) */
  score?: number;
}

export interface People {
  owner: string;
  followers: PersonView[];
  following: PersonView[];
  totals: { followers: number; following: number };
  note: string;
}

// network change diff — who followed/unfollowed since the last /api/refresh
// (has_history is false on the first refresh, when no archive exists yet)
export interface PeopleDiff {
  ok: boolean;
  owner: string;
  has_history: boolean;
  added: { followers: string[]; following: string[] };
  gone: { followers: string[]; following: string[] };
}

export interface OwnerList {
  owners: string[];
  current: string;
}

// returned by every JSON route when the owner has no local snapshot yet
export interface NoSnapshot {
  status: 404;
  error: "no_snapshot";
  owner: string;
  hint: string;
}

export function isNoSnapshot(x: unknown): x is NoSnapshot {
  return (
    typeof x === "object" && x !== null &&
    (x as NoSnapshot).error === "no_snapshot"
  );
}
