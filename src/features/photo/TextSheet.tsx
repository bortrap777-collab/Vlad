import { Sheet } from '../../components/ui';
import { TextSizeControl } from './TextSizeControl';
import { Icon } from '../../components/Icon';
import { TEXT_COLORS, TEXT_FONTS, type TextFont, type TextLayer, type TextStyle } from './pipeline';

const STYLES: { id: TextStyle; label: string }[] = [
  { id: 'plain', label: 'Обычный' },
  { id: 'shadow', label: 'Тень' },
  { id: 'box', label: 'Плашка' },
];

export function TextSheet({
  layer,
  onChange,
  onDelete,
  onClose,
}: {
  layer: TextLayer | null;
  onChange: (patch: Partial<TextLayer>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!layer} onClose={onClose} title="Текст">
      {layer && (
        <div className="text-editor">
          <textarea
            id="text-input"
            className="text-input"
            value={layer.text}
            rows={2}
            maxLength={300}
            placeholder="Введите текст"
            onChange={(e) => onChange({ text: e.target.value })}
            style={{ fontFamily: TEXT_FONTS[layer.font].family, fontWeight: TEXT_FONTS[layer.font].weight }}
          />

          <div className="field">
            <span className="field-label">Шрифт</span>
            <div className="chip-row">
              {(Object.keys(TEXT_FONTS) as TextFont[]).map((f) => (
                <button
                  key={f}
                  className={`pill ${layer.font === f ? 'is-active' : ''}`}
                  style={{ fontFamily: TEXT_FONTS[f].family, fontWeight: TEXT_FONTS[f].weight }}
                  onClick={() => onChange({ font: f })}
                >
                  {TEXT_FONTS[f].name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Цвет</span>
            <div className="swatches">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${layer.color === c ? 'is-active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Цвет ${c}`}
                  onClick={() => onChange({ color: c })}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Стиль</span>
            <div className="segmented">
              {STYLES.map((s) => (
                <button key={s.id} className={layer.style === s.id ? 'is-active' : ''} onClick={() => onChange({ style: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Размер</span>
            <TextSizeControl size={layer.size} rotation={layer.rotation} onChange={(size) => onChange({ size })} onEnd={() => undefined} onResetRotation={() => onChange({ rotation: 0 })} />
          </div>

          <div className="btn-pair">
            <button className="btn btn-danger-soft" onClick={onDelete}>
              <Icon name="trash" size={18} /> Удалить
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
