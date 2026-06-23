/**
 * Daily FIFA World Cup 2026 score sync from the openfootball worldcup.json feed.
 *
 * Scheduled (EventBridge) Lambda. Idempotently updates, on every run:
 *   - fixture scores + statuses
 *   - gameweek statuses on the competition schedule
 *   - competition status (upcoming -> active -> completed)
 *   - player totalPoints from goals scored (goals-only, best-effort name match)
 *
 * Sources:
 *   https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json
 *   https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.teams.json
 */
import type { Handler } from 'aws-lambda';
import { FantasyRepository, buildCompetitionKey } from '@fantasy/shared';

const TABLE_NAME = process.env.TABLE_NAME;
const COMPETITION_ID = process.env.COMPETITION_ID ?? 'world-cup-2026';

const FIXTURES_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json';
const TEAMS_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.teams.json';
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

interface RawGoal { name?: string; minute?: string | number; owngoal?: boolean; og?: boolean; }
interface RawMatch {
  num?: number; round?: string; stage?: string; name?: string; date?: string; time?: string;
  team1?: unknown; team2?: unknown; score?: { ft?: number[]; ht?: number[] };
  goals1?: RawGoal[]; goals2?: RawGoal[];
}
interface RawRound { name?: string; round?: string; matches?: RawMatch[]; }
interface RawTeam { name?: string; name_normalised?: string; code?: string; fifa_code?: string; }

interface FixtureItem extends Record<string, unknown> {
  PK: string; SK: string; fixtureId: string; gameweek: number;
  homeTeamId: string; awayTeamId: string; status: string;
}
interface PlayerItem extends Record<string, unknown> {
  PK: string; SK: string; playerId: string; name: string;
  position: string; realTeamId: string; price: number; totalPoints: number;
}
interface Gameweek { gameweek: number; transferDeadline: string; status: string; }
interface CompetitionItem extends Record<string, unknown> {
  PK: string; SK: string; competitionId: string; scoringRulesetId: string;
  status: string; schedule: { gameweeks: Gameweek[] };
}
interface RulesetItem extends Record<string, unknown> {
  rules?: { stat: string; position?: string; points: number }[];
}

function slugify(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function deriveCode(name: string): string {
  const l = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '');
  return (l.slice(0, 3) || 'UNK').toUpperCase().padEnd(3, 'X');
}
function pickArray<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    for (const k of keys) { const v = (raw as Record<string, unknown>)[k]; if (Array.isArray(v)) return v as T[]; }
  }
  return [];
}
function parseKickoff(date: string, time?: string): string {
  const raw = time ?? '18:00';
  const hm = /(\d{1,2}):(\d{2})/.exec(raw);
  const hh = hm ? Number(hm[1]) : 18;
  const mm = hm ? Number(hm[2]) : 0;
  const off = /UTC\s*([+-]\d{1,2})/i.exec(raw);
  const o = off ? Number(off[1]) : 0;
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y || 2026, (mo || 1) - 1, d || 1, hh - o, mm)).toISOString();
}
function buildTeamCodeMap(teams: RawTeam[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of teams) {
    const code = (t.fifa_code ?? t.code ?? (t.name ? deriveCode(t.name) : '')).toUpperCase();
    if (!code) continue;
    for (const nm of [t.name, t.name_normalised]) if (nm) map.set(nm.toLowerCase(), code);
  }
  return map;
}
function resolveTeamId(team: unknown, codeMap: Map<string, string>): string {
  if (team && typeof team === 'object') {
    const ob = team as Record<string, unknown>;
    const code = (ob.code ?? ob.fifa_code) as string | undefined;
    if (code) return code.toUpperCase();
    const name = (ob.name ?? ob.team) as string | undefined;
    if (name) return codeMap.get(name.toLowerCase()) ?? deriveCode(name);
    return 'TBD';
  }
  if (typeof team === 'string') return codeMap.get(team.toLowerCase()) ?? team.toUpperCase();
  return 'TBD';
}
function earliest(matches: RawMatch[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const m of matches) { if (!m.date) continue; const ts = Date.parse(parseKickoff(m.date, m.time)); if (ts < min) min = ts; }
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}
function buildRounds(raw: unknown): { name: string; matches: RawMatch[] }[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).rounds)) {
    const rounds = (raw as Record<string, unknown>).rounds as RawRound[];
    return rounds.map((r, i) => ({ name: r.name ?? r.round ?? `Round ${i + 1}`, matches: Array.isArray(r.matches) ? r.matches : [] }));
  }
  const matches = pickArray<RawMatch>(raw, ['matches']);
  const groups = new Map<string, RawMatch[]>();
  for (const m of matches) { const key = m.round ?? m.stage ?? m.name ?? 'Round 1'; const b = groups.get(key); if (b) b.push(m); else groups.set(key, [m]); }
  const rounds = Array.from(groups.entries()).map(([name, ms]) => ({ name, matches: ms }));
  rounds.sort((a, b) => earliest(a.matches) - earliest(b.matches));
  return rounds;
}
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.json();
}
function isOwnGoal(g: RawGoal): boolean {
  if (g.owngoal === true || g.og === true) return true;
  if (typeof g.name === 'string' && /\(\s*o\.?g\.?\s*\)/i.test(g.name)) return true;
  return false;
}
function cleanName(name: string): string {
  return name.replace(/\((?:pen|p|o\.?g\.?)\.?\)/gi, '').trim();
}
async function queryAll<T extends Record<string, unknown>>(
  repo: FantasyRepository,
  opts: Parameters<FantasyRepository['query']>[0],
): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await repo.query<T>({ ...opts, exclusiveStartKey: startKey });
    items.push(...(res.items as T[]));
    startKey = res.lastEvaluatedKey;
  } while (startKey);
  return items;
}

export const handler: Handler = async () => {
  if (!TABLE_NAME) throw new Error('TABLE_NAME environment variable is not set');
  const repo = new FantasyRepository({ tableName: TABLE_NAME });
  const now = Date.now();

  const [fixturesRaw, teamsRaw] = await Promise.all([fetchJson(FIXTURES_URL), fetchJson(TEAMS_URL)]);
  const codeMap = buildTeamCodeMap(pickArray<RawTeam>(teamsRaw, ['teams']));

  const competition = await repo.get<CompetitionItem>(`COMPETITION#${COMPETITION_ID}`, 'META');
  if (!competition) throw new Error(`Competition ${COMPETITION_ID} not found`);

  const goalPointsByPos: Record<string, number> = { FWD: 4, MID: 5, DEF: 6, GK: 6 };
  const ruleset = await repo.get<RulesetItem>(`RULESET#${competition.scoringRulesetId}`, 'META');
  if (ruleset?.rules) {
    for (const r of ruleset.rules) if (r.stat === 'goals' && r.position) goalPointsByPos[r.position] = r.points;
  }

  const fixtures = await queryAll<FixtureItem>(repo, {
    keyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    expressionAttributeValues: { ':pk': `COMPETITION#${COMPETITION_ID}`, ':sk': 'FIXTURE#' },
  });
  const fixtureByMatch = new Map<string, FixtureItem>();
  for (const f of fixtures) fixtureByMatch.set(`${f.gameweek}|${f.homeTeamId}|${f.awayTeamId}`, f);

  const players = await queryAll<PlayerItem>(repo, {
    indexName: 'GSI2',
    keyConditionExpression: 'GSI2PK = :pk',
    expressionAttributeValues: { ':pk': `COMP#${COMPETITION_ID}` },
  });
  const playerByKey = new Map<string, PlayerItem>();
  for (const p of players) playerByKey.set(`${p.realTeamId}|${slugify(p.name)}`, p);

  const rounds = buildRounds(fixturesRaw);
  const gwStatuses = new Map<number, string[]>();
  const fixtureUpdates: { fixture: FixtureItem; status: string; score?: [number, number] }[] = [];
  const scorerGoals = new Map<string, { item: PlayerItem; goals: number }>();
  let earliestOverall = Number.POSITIVE_INFINITY;
  let latestOverall = Number.NEGATIVE_INFINITY;

  rounds.forEach((round, ri) => {
    const gwNum = ri + 1;
    const statuses = gwStatuses.get(gwNum) ?? [];
    for (const m of round.matches) {
      const date = m.date ?? '2026-06-11';
      const kickoffTs = Date.parse(parseKickoff(date, m.time));
      if (kickoffTs < earliestOverall) earliestOverall = kickoffTs;
      if (kickoffTs > latestOverall) latestOverall = kickoffTs;

      const homeCode = resolveTeamId(m.team1, codeMap);
      const awayCode = resolveTeamId(m.team2, codeMap);
      const ft = m.score?.ft;
      const hasScore = Array.isArray(ft) && ft.length >= 2 && typeof ft[0] === 'number' && typeof ft[1] === 'number';

      let status: string;
      if (hasScore) status = 'finished';
      else if (kickoffTs <= now && now < kickoffTs + LIVE_WINDOW_MS) status = 'live';
      else status = 'scheduled';
      statuses.push(status);

      const fixture = fixtureByMatch.get(`${gwNum}|${homeCode}|${awayCode}`);
      if (fixture) {
        if (hasScore) {
          const home = Number((ft as number[])[0]);
          const away = Number((ft as number[])[1]);
          fixtureUpdates.push({ fixture, status: 'finished', score: [home, away] });
        } else if (status !== fixture.status) {
          fixtureUpdates.push({ fixture, status });
        }
      }

      if (hasScore) {
        const credit = (goals: RawGoal[] | undefined, code: string) => {
          for (const g of goals ?? []) {
            if (!g.name || isOwnGoal(g)) continue;
            const p = playerByKey.get(`${code}|${slugify(cleanName(String(g.name)))}`);
            if (p) {
              const e = scorerGoals.get(p.playerId) ?? { item: p, goals: 0 };
              e.goals += 1;
              scorerGoals.set(p.playerId, e);
            }
          }
        };
        credit(m.goals1, homeCode);
        credit(m.goals2, awayCode);
      }
    }
    gwStatuses.set(gwNum, statuses);
  });

  for (const u of fixtureUpdates) {
    if (u.score) {
      await repo.update(u.fixture.PK, u.fixture.SK, 'SET homeScore = :h, awayScore = :a, #s = :st',
        { '#s': 'status' }, { ':h': u.score[0], ':a': u.score[1], ':st': u.status });
    } else {
      await repo.update(u.fixture.PK, u.fixture.SK, 'SET #s = :st', { '#s': 'status' }, { ':st': u.status });
    }
  }

  const scorers = Array.from(scorerGoals.values());
  for (const s of scorers) {
    const pts = s.goals * (goalPointsByPos[s.item.position] ?? 5);
    const gsk = `POINTS#${String(pts).padStart(10, '0')}`;
    await repo.update(s.item.PK, s.item.SK, 'SET totalPoints = :tp, GSI2SK = :gsk',
      undefined, { ':tp': pts, ':gsk': gsk });
  }

  const gameweeks: Gameweek[] = competition.schedule.gameweeks.map((gw) => {
    const statuses = gwStatuses.get(gw.gameweek) ?? [];
    let status: string;
    if (statuses.length > 0 && statuses.every((s) => s === 'finished')) status = 'finalized';
    else if (statuses.some((s) => s === 'live') || (Date.parse(gw.transferDeadline) <= now && statuses.some((s) => s === 'finished'))) status = 'live';
    else status = 'upcoming';
    return { ...gw, status };
  });

  let compStatus: string;
  if (gameweeks.length > 0 && gameweeks.every((g) => g.status === 'finalized')) compStatus = 'completed';
  else if (gameweeks.some((g) => g.status === 'live' || g.status === 'finalized')) compStatus = 'active';
  else compStatus = 'upcoming';

  const startTs = Number.isFinite(earliestOverall) ? new Date(earliestOverall).toISOString() : new Date().toISOString();
  const endTs = Number.isFinite(latestOverall) ? new Date(latestOverall).toISOString() : startTs;
  const compKeys = buildCompetitionKey({ compId: COMPETITION_ID, status: compStatus, startTs, endTs });
  await repo.put({ ...competition, ...compKeys, status: compStatus, schedule: { gameweeks }, updatedAt: new Date().toISOString() });

  const result = {
    competitionId: COMPETITION_ID,
    source: 'openfootball',
    fixturesUpdated: fixtureUpdates.length,
    playersScored: scorers.length,
    competitionStatus: compStatus,
    gameweeks: gameweeks.map((g) => ({ gameweek: g.gameweek, status: g.status })),
  };
  console.log('worldcup-daily-sync complete', JSON.stringify(result));
  return result;
};
