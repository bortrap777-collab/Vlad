import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { DIALOGUES } from '../../src/content/dialogues';
import { LEVELS } from '../../src/content/levels';
import { ITEMS, CLUES, COMBINE_RULES } from '../../src/content/items';
import { STAGES, REQUIRED_CLUES } from '../../src/content/quests';
import { CHARACTERS } from '../../src/content/characters';
import type { Cond, Effect } from '../../src/core/types';

const manifest = JSON.parse(readFileSync('public/assets/gen/manifest.json', 'utf8'));
const stageIds = new Set(STAGES.map((s) => s.id));

function walkCond(c: Cond | undefined, f: (c: Cond) => void) {
  if (!c) return;
  f(c);
  if ('not' in c) walkCond(c.not, f);
  if ('all' in c) c.all.forEach((x) => walkCond(x, f));
  if ('any' in c) c.any.forEach((x) => walkCond(x, f));
}
function checkCond(c: Cond | undefined, where: string, errs: string[]) {
  walkCond(c, (x) => {
    if ('stage' in x && !stageIds.has(x.stage)) errs.push(`${where}: unknown stage ${x.stage}`);
    if ('stageAtLeast' in x && !stageIds.has(x.stageAtLeast)) errs.push(`${where}: unknown stage ${x.stageAtLeast}`);
    if ('has' in x && !(x.has in ITEMS)) errs.push(`${where}: unknown item ${x.has}`);
    if ('hasClue' in x && !(x.hasClue in CLUES)) errs.push(`${where}: unknown clue ${x.hasClue}`);
  });
}
function checkEffects(e: Effect[] | undefined, where: string, errs: string[]) {
  for (const x of e ?? []) {
    if ('stage' in x && !stageIds.has(x.stage)) errs.push(`${where}: unknown stage ${x.stage}`);
    if ('give' in x && !(x.give in ITEMS)) errs.push(`${where}: unknown item ${x.give}`);
    if ('take' in x && !(x.take in ITEMS)) errs.push(`${where}: unknown item ${x.take}`);
    if ('clue' in x && !(x.clue in CLUES)) errs.push(`${where}: unknown clue ${x.clue}`);
  }
}

describe('content integrity', () => {
  it('dialogue references are valid', () => {
    const errs: string[] = [];
    for (const d of Object.values(DIALOGUES)) {
      d.start.forEach((s, i) => checkCond(s.cond, `${d.id}.start${i}`, errs));
      for (const [id, n] of Object.entries(d.nodes)) {
        if (!(n.speaker in CHARACTERS)) errs.push(`${d.id}.${id}: unknown speaker`);
        checkEffects(n.effects, `${d.id}.${id}`, errs);
        n.choices?.forEach((c, i) => {
          checkCond(c.cond, `${d.id}.${id}.c${i}`, errs);
          checkEffects(c.effects, `${d.id}.${id}.c${i}`, errs);
        });
        n.branch?.forEach((b, i) => checkCond(b.cond, `${d.id}.${id}.b${i}`, errs));
      }
    }
    expect(errs).toEqual([]);
  });

  it('levels reference existing dialogues, textures and stages', () => {
    const errs: string[] = [];
    const tex = new Set([...Object.keys(manifest.images), 'dog', 'items']);
    for (const L of Object.values(LEVELS)) {
      for (const p of [...L.parallax.map((p) => p.key), L.backdrop]) if (!tex.has(p)) errs.push(`${L.id}: missing texture ${p}`);
      for (const pr of L.props) {
        if (!tex.has(pr.texture)) errs.push(`${pr.id}: missing texture ${pr.texture}`);
        if (pr.x < 0 || pr.x > L.width) errs.push(`${pr.id}: outside level`);
        checkCond(pr.cond, pr.id, errs);
      }
      for (const it of L.interactables) {
        checkCond(it.cond, it.id, errs);
        if ('dialogue' in it.action && !DIALOGUES[it.action.dialogue]) errs.push(`${it.id}: missing dialogue ${it.action.dialogue}`);
        if ('door' in it.action) it.action.requires?.forEach((r) => !DIALOGUES[r.elseDialogue] && errs.push(`${it.id}: missing dialogue ${r.elseDialogue}`));
        if (it.x < L.bounds[0] - it.range || it.x > L.bounds[1] + it.range) errs.push(`${it.id}: unreachable at x=${it.x}`);
      }
      for (const n of L.npcs) {
        if (!DIALOGUES[n.dialogue]) errs.push(`${n.id}: missing dialogue ${n.dialogue}`);
        if (!manifest.chars[n.id]) errs.push(`${n.id}: no sprite sheet`);
        checkCond(n.cond, `npc ${n.id}`, errs);
      }
      for (const l of L.lights) if (!tex.has(l.texture)) errs.push(`light texture ${l.texture}`);
    }
    expect(errs).toEqual([]);
  });

  it('every generated asset file exists', () => {
    const missing: string[] = [];
    for (const k of Object.keys(manifest.images)) if (!existsSync(`public/assets/gen/${k}.png`)) missing.push(k);
    for (const id of Object.keys(manifest.chars)) {
      if (!existsSync(`public/assets/gen/chars/${id}.png`)) missing.push('chars/' + id);
      if (!existsSync(`public/assets/gen/portraits/${id}.png`)) missing.push('portraits/' + id);
      for (const a of ['idle', 'walk', 'turn', 'talk']) if (!manifest.chars[id][a]) missing.push(`${id}.${a} animation`);
      expect(manifest.chars[id].walk.end - manifest.chars[id].walk.start + 1).toBeGreaterThanOrEqual(5);
    }
    for (const a of manifest.audio) for (const f of manifest.audioFormats ?? ['wav']) if (!existsSync(`public/assets/gen/audio/${a}.${f}`)) missing.push(`${a}.${f}`);
    expect(missing).toEqual([]);
  });

  it('every character with dialogue lines has a portrait', () => {
    for (const d of Object.values(DIALOGUES))
      for (const n of Object.values(d.nodes)) if (CHARACTERS[n.speaker].hasPortrait) expect(manifest.portraits).toContain(n.speaker);
  });

  it('required clues are obtainable from dialogue', () => {
    const given = new Set<string>();
    for (const d of Object.values(DIALOGUES))
      for (const n of Object.values(d.nodes)) {
        for (const e of [...(n.effects ?? []), ...(n.choices ?? []).flatMap((c) => c.effects ?? [])]) if ('clue' in e) given.add(e.clue);
      }
    for (const c of REQUIRED_CLUES) expect(given).toContain(c);
    for (const r of COMBINE_RULES) expect(CLUES[r.result].insight).toBe(true);
  });
});

describe('Russian text quality', () => {
  const allowedLatin = /\b(E|J|H|C|A|D|W|S|Esc|Enter|Shift|Tab|Ctrl|Alt|Backspace|Num|SIL|OFL|MIT|Phaser|PT|Sans|Tiny5|ParaType|Project|Authors|The|tools)\b/g;
  const texts: [string, string][] = [];
  for (const d of Object.values(DIALOGUES))
    for (const [id, n] of Object.entries(d.nodes)) {
      texts.push([`${d.id}.${id}`, n.text]);
      n.choices?.forEach((c, i) => texts.push([`${d.id}.${id}.c${i}`, c.text]));
    }
  for (const it of Object.values(ITEMS)) texts.push([it.id, it.name + ' ' + it.description]);
  for (const c of Object.values(CLUES)) texts.push([c.id, c.title + ' ' + c.text]);
  for (const s of STAGES) texts.push([s.id, s.objective + ' ' + (s.hint ?? '')]);

  it('no stray Latin letters in player-facing text', () => {
    const bad = texts.filter(([, t]) => /[A-Za-z]/.test(t.replace(allowedLatin, '')));
    expect(bad).toEqual([]);
  });

  it('typography: «ёлочки», no straight double quotes, no double spaces, no hyphen-as-dash', () => {
    const bad = texts.filter(([, t]) => /"/.test(t) || / {2}/.test(t) || / - /.test(t) || /\s[,.!?]/.test(t));
    expect(bad).toEqual([]);
  });

  it('balanced «» quotes and parentheses', () => {
    const bad = texts.filter(([, t]) => (t.match(/«/g) ?? []).length !== (t.match(/»/g) ?? []).length || (t.match(/\(/g) ?? []).length !== (t.match(/\)/g) ?? []).length);
    expect(bad).toEqual([]);
  });
});
