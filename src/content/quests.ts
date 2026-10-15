import type { QuestStage } from '../core/types';

/** Main quest of Chapter 1, in order. Stages only ever advance. */
export const STAGES: QuestStage[] = [
  { id: 'intro', objective: 'Послушать, о чём спорят родители' },
  { id: 'leave_home', objective: 'Взять ключ с вешалки и выйти во двор', hint: 'Ключ висит в прихожей, у двери.' },
  { id: 'meet_yard', objective: 'Осмотреться во дворе', hint: 'Соседи на лавочке у подъезда знают всё про всех.' },
  { id: 'help_dog', objective: 'Узнать, кто скулит у гаражей', hint: 'Гаражи — в правой части двора. Подходи к собаке шагом.' },
  { id: 'defend', objective: 'Вернуться к детской площадке', hint: 'Площадка — за сеткой, посреди двора.' },
  { id: 'talk_olya', objective: 'Поговорить с девочкой в розовом' },
  { id: 'investigate', objective: 'Разузнать, что случилось с Димкой', hint: 'Поговори со Светой у качелей и с Лёхой у гаражей. Пёс что-то учуял?' },
  { id: 'deduce', objective: 'Сопоставить улики в дневнике', hint: 'Открой дневник (J), выбери две улики и нажми «Сопоставить».' },
  { id: 'tell_olya', objective: 'Рассказать Оле о своей догадке' },
  { id: 'go_home', objective: 'Вернуться домой', hint: 'Подъезд — в левой части двора.' },
  { id: 'done', objective: 'Глава завершена' },
];

export function stageIndex(id: string): number {
  const i = STAGES.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

export function stageDef(id: string): QuestStage {
  return STAGES[stageIndex(id)];
}

/** Clues needed before the deduction stage unlocks. */
export const REQUIRED_CLUES = ['clue_grandma', 'clue_officer', 'clue_mitten', 'clue_drawing'] as const;
