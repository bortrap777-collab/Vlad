/** Shared content interfaces. All player-facing strings live in src/content. */

export type CharId =
  | 'kolya' | 'olya' | 'sveta' | 'lyokha' | 'seryoga' | 'zheka' | 'tolstyi'
  | 'zina' | 'vitya' | 'sasha' | 'alexey' | 'mama' | 'papa' | 'dog' | 'narrator';

export type Expr = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised';
export type FlagValue = boolean | number | string;

export type ItemId = 'key' | 'bread' | 'mitten' | 'drawing' | 'flashlight' | 'cans';
export type ClueId =
  | 'clue_missing' | 'clue_grandma' | 'clue_officer' | 'clue_mitten' | 'clue_drawing'
  | 'clue_footprints' | 'clue_sasha' | 'insight_lie' | 'insight_garages';

export type Cond =
  | { flag: string; eq?: FlagValue }
  | { notFlag: string }
  | { flagGte: string; value: number }
  | { has: ItemId }
  | { hasClue: ClueId }
  | { stage: string }
  | { stageAtLeast: string }
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] };

export type Effect =
  | { set: string; value?: FlagValue }
  | { inc: string; by?: number }
  | { give: ItemId }
  | { take: ItemId }
  | { clue: ClueId }
  | { stage: string }
  | { event: string };

export interface Choice {
  text: string;
  next: string | null;
  cond?: Cond;
  effects?: Effect[];
  /** Short tag stored in the choice log (end-of-chapter summary). */
  tag?: string;
}

export interface DialogueNode {
  speaker: CharId;
  expr?: Expr;
  text: string;
  next?: string | null;
  /** Conditional continuation evaluated after this node's effects; first match wins. */
  branch?: { cond?: Cond; node: string | null }[];
  choices?: Choice[];
  effects?: Effect[];
  /** Optional caption for sounds, shown when subtitles are enabled. */
  sfx?: string;
}

export interface Dialogue {
  id: string;
  /** First matching entry wins. */
  start: { cond?: Cond; node: string }[];
  nodes: Record<string, DialogueNode>;
}

export interface ItemDef { id: ItemId; name: string; description: string; icon: number }
export interface ClueDef { id: ClueId; title: string; text: string; insight?: boolean }
export interface CombineRule { a: ClueId; b: ClueId; result: ClueId; text: string }

export interface QuestStage {
  id: string;
  objective: string;
  hint?: string;
}

export interface ChapterSummaryLine { flag: string; text: Record<string, string> }
