/** Pure dialogue runner: walks a dialogue graph against a GameState. */
import type { Choice, Dialogue, DialogueNode } from './types';
import { applyEffects, evalCond, type GameState, type StateEvent } from './state';

export interface NodeView {
  id: string;
  node: DialogueNode;
  choices: { index: number; choice: Choice }[];
}

export class DialogueRunner {
  private nodeId: string | null;
  readonly events: StateEvent[] = [];

  constructor(public readonly dialogue: Dialogue, private readonly state: GameState) {
    const entry = dialogue.start.find((e) => evalCond(state, e.cond));
    this.nodeId = entry ? entry.node : null;
    if (this.nodeId) this.enter(this.nodeId);
  }

  get done(): boolean {
    return this.nodeId === null;
  }

  get current(): NodeView | null {
    if (!this.nodeId) return null;
    const node = this.dialogue.nodes[this.nodeId];
    const choices = (node.choices ?? []).map((choice, index) => ({ index, choice })).filter((c) => evalCond(this.state, c.choice.cond));
    return { id: this.nodeId, node, choices };
  }

  private enter(id: string) {
    const node = this.dialogue.nodes[id];
    if (!node) throw new Error(`Dialogue ${this.dialogue.id}: missing node ${id}`);
    this.events.push(...applyEffects(this.state, node.effects));
  }

  private go(next: string | null | undefined) {
    this.nodeId = next ?? null;
    if (this.nodeId) this.enter(this.nodeId);
  }

  /** Advance a node without choices. Returns false if a choice is required. */
  advance(): boolean {
    const v = this.current;
    if (!v) return true;
    if (v.choices.length) return false;
    if (v.node.branch) {
      const b = v.node.branch.find((x) => evalCond(this.state, x.cond));
      this.go(b ? b.node : null);
    } else this.go(v.node.next);
    return true;
  }

  choose(visibleIndex: number): void {
    const v = this.current;
    if (!v || !v.choices[visibleIndex]) throw new Error('Invalid choice');
    const { choice } = v.choices[visibleIndex];
    this.events.push(...applyEffects(this.state, choice.effects));
    if (choice.tag && !this.state.choices.includes(choice.tag)) this.state.choices.push(choice.tag);
    this.go(choice.next);
  }

  /** Drain accumulated state events (for toasts/sounds). */
  takeEvents(): StateEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

/** Static validation used by tests: every referenced node exists, every node reachable. */
export function validateDialogue(d: Dialogue): string[] {
  const errs: string[] = [];
  const ids = new Set(Object.keys(d.nodes));
  const refs = (id: string | null | undefined, from: string) => {
    if (id && !ids.has(id)) errs.push(`${d.id}.${from} → missing node "${id}"`);
  };
  d.start.forEach((s, i) => refs(s.node, `start[${i}]`));
  for (const [id, node] of Object.entries(d.nodes)) {
    refs(node.next ?? null, id);
    node.choices?.forEach((c, i) => refs(c.next, `${id}.choice${i}`));
    node.branch?.forEach((b, i) => refs(b.node, `${id}.branch${i}`));
    if (node.choices?.length && (node.next || node.branch)) errs.push(`${d.id}.${id}: has both choices and next`);
    if (!node.text.trim()) errs.push(`${d.id}.${id}: empty text`);
  }
  // reachability
  const seen = new Set<string>();
  const stack = d.start.map((s) => s.node);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !ids.has(id)) continue;
    seen.add(id);
    const node = d.nodes[id];
    if (node.next) stack.push(node.next);
    node.choices?.forEach((c) => c.next && stack.push(c.next));
    node.branch?.forEach((b) => b.node && stack.push(b.node));
  }
  for (const id of ids) if (!seen.has(id)) errs.push(`${d.id}.${id}: unreachable`);
  return errs;
}
