/** Explicit service container shared by all scenes (created once in main.ts). */
import { loadSettings, saveSettings, type Settings } from './core/settings';
import { InputMap } from './systems/input';
import { AudioManager } from './systems/audio';
import { Session } from './core/session';
import { SaveManager } from './core/save';

export class Services {
  settings: Settings = loadSettings();
  input = new InputMap(this.settings);
  audio = new AudioManager(this.settings);
  saves = new SaveManager();
  session: Session | null = null;

  updateSettings(mut: (s: Settings) => void) {
    mut(this.settings);
    saveSettings(this.settings);
    this.input.setSettings(this.settings);
    this.audio.setSettings(this.settings);
  }
}

let instance: Services | null = null;
export function services(): Services {
  if (!instance) instance = new Services();
  return instance;
}
