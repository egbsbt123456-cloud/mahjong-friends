// 麻将（广东麻将）引擎类型。状态结构见 docs/game-rules/mahjong-gd.md 第 7.3 节。
type Rng = (maxExclusive: number) => number;
type PatternKey = 'chicken' | 'pinghu' | 'pengpeng' | 'qidui' | 'shisanyao' | 'qingyise' | 'hunyise'
  | 'dasanyuan' | 'xiaosanyuan' | 'dasixi' | 'xiaosixi' | 'tianhu' | 'dihu';
interface MahjongSettings {
  honors: boolean; flowers: boolean;
  chi: boolean; pong: boolean; exposedKong: boolean; concealedKong: boolean; addedKong: boolean;
  selfDraw: boolean; discardWin: boolean; robKong: boolean;
  ghost: 'none' | 'red' | 'flip';
  patterns: Record<PatternKey, boolean>;
  turnSeconds: 15 | 30 | 60;
}
interface MahjongTile { id: number; code: string }
type MahjongAction =
  | { type: 'discard'; tileId: number }
  | { type: 'selfWin' } | { type: 'concealedKong'; code: string } | { type: 'addedKong'; code: string }
  | { type: 'win' } | { type: 'pong' } | { type: 'exposedKong' } | { type: 'chi'; tiles: number[] }
  | { type: 'pass' } | { type: 'resume' };
// 服务器内部完整状态（含牌墙），只在服务器读取
type MahjongState = { [key: string]: any };
type MahjongView = { [key: string]: any };
interface WinAnalysis { win: boolean; form: 'standard' | 'qidui' | 'shisanyao' | null; patterns: PatternKey[]; names: string[] }
declare const engine: {
  RULES_VERSION: string; RESPONSE_MS: number; HOSTED_STEP_MS: number; ALL_HOSTED_MS: number;
  PATTERN_KEYS: PatternKey[]; PATTERN_NAMES: Record<PatternKey, string>;
  idx(code: string): number; codeOf(index: number): string; nextGhost(code: string): string;
  buildDeck(settings: { honors: boolean; flowers: boolean }): MahjongTile[];
  sortTiles(tiles: MahjongTile[]): MahjongTile[];
  defaultSettings(): MahjongSettings;
  normalizeSettings(input: unknown): { settings: MahjongSettings; error: string | null };
  parseSettings(input: unknown): MahjongSettings;
  analyzeWin(hand: Array<string | { code: string; wild: boolean }>, melds: Array<{ kind: string; codes: string[] }>,
    opts: { ghost: string | null; settings: MahjongSettings; timing: 'tianhu' | 'dihu' | null }): WinAnalysis;
  start(settings: unknown, dealer: number | null, rng: Rng, now: number, handNo?: number): MahjongState;
  apply(state: MahjongState, seat: number, action: MahjongAction | { type: string; [k: string]: unknown }, now: number): MahjongState;
  advance(state: MahjongState, now: number): { state: MahjongState; changed: boolean };
  legal(state: MahjongState, seat: number): { hosted: boolean; canResume: boolean; turn: null | { discard: boolean; selfWin: boolean; concealedKongs: string[]; addedKongs: string[] }; response: null | { actions: string[]; chi: string[][] } };
  view(state: MahjongState, seat: number): MahjongView;
  nextDealer(state: MahjongState): number | null;
};
export = engine;
