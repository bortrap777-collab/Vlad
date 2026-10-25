import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import type { LayerStack, PhotoLayer } from './layers';

interface Props {
  stack: LayerStack | null;
  selected: string | null;
  files: Record<string, string>;
  srcUrl: string | null;
  blurUrl: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, p: Partial<PhotoLayer>, end: boolean) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAddPhoto: () => void;
  onMerge: () => void;
  onUnmerge: () => void;
  onBrush: (id: string) => void;
}

function Thumb({ l, files, srcUrl, blurUrl }: { l: PhotoLayer; files: Record<string, string>; srcUrl: string | null; blurUrl: string | null }) {
  if (l.kind === 'color') return <span className="layer-thumb" style={{ background: l.color }} />;
  const url = l.kind === 'blur' ? blurUrl : l.media ? files[l.media] : srcUrl;
  const mask = l.mask ? files[l.mask] : null;
  const style: CSSProperties = mask
    ? { WebkitMaskImage: `url("${mask}")`, maskImage: `url("${mask}")`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }
    : {};
  return <span className="layer-thumb checker-bg">{url && <img src={url} alt="" draggable={false} style={style} />}</span>;
}

/** Вкладка «Слои»: список (верхний — первый), действия с выбранным слоем, объединение. */
export function LayersPanel(p: Props) {
  const { stack, selected } = p;
  if (!stack) {
    return (
      <div className="layers-panel">
        <p className="muted small">Слои появятся после «Удалить фон» или если добавить ещё одно фото поверх.</p>
        <button className="pill pill-add" onClick={p.onAddPhoto}>
          <Icon name="plus" size={16} stroke={2.6} /> Добавить фото слоем
        </button>
      </div>
    );
  }
  if (stack.merged) {
    return (
      <div className="layers-panel">
        <div className="layer-merged">
          <Icon name="merge" size={22} />
          <div>
            <div className="req-title">Слои объединены</div>
            <div className="muted small">Фильтры и настройки теперь меняют всё фото целиком.</div>
          </div>
        </div>
        <button className="btn btn-soft btn-block" onClick={p.onUnmerge}>
          <Icon name="unmerge" size={18} /> Разъединить
        </button>
      </div>
    );
  }

  const list = [...stack.layers].reverse();
  const sel = stack.layers.find((l) => l.id === selected) ?? null;
  const index = sel ? stack.layers.indexOf(sel) : -1;
  return (
    <div className="layers-panel">
      <div className="layer-list" role="listbox" aria-label="Слои">
        {list.map((l) => (
          <button
            key={l.id}
            role="option"
            aria-selected={l.id === selected}
            className={`layer-card ${l.id === selected ? 'is-active' : ''} ${l.visible ? '' : 'is-hidden'}`}
            onClick={() => p.onSelect(l.id)}
          >
            <Thumb l={l} files={p.files} srcUrl={p.srcUrl} blurUrl={p.blurUrl} />
            <span className="layer-name">{l.name}</span>
          </button>
        ))}
        <button className="layer-card layer-add" onClick={p.onAddPhoto} aria-label="Добавить фото слоем">
          <span className="layer-thumb">
            <Icon name="plus" size={22} stroke={2.4} />
          </span>
          <span className="layer-name">Фото</span>
        </button>
      </div>

      {sel ? (
        <>
          <div className="layer-actions">
            <button className="icon-btn icon-btn-sm" onClick={() => p.onMove(sel.id, 1)} disabled={index >= stack.layers.length - 1} aria-label="Выше">
              <Icon name="arrowUp" size={20} />
            </button>
            <button className="icon-btn icon-btn-sm" onClick={() => p.onMove(sel.id, -1)} disabled={index <= 0} aria-label="Ниже">
              <Icon name="arrowDown" size={20} />
            </button>
            <button className="icon-btn icon-btn-sm" onClick={() => p.onUpdate(sel.id, { visible: !sel.visible }, true)} aria-label={sel.visible ? 'Скрыть' : 'Показать'}>
              <Icon name={sel.visible ? 'eye' : 'eyeOff'} size={20} />
            </button>
            {sel.kind === 'photo' && (
              <>
                <button className="icon-btn icon-btn-sm" onClick={() => p.onUpdate(sel.id, { flip: !sel.flip }, true)} aria-label="Отразить">
                  <Icon name="flip" size={20} />
                </button>
                <button className="icon-btn icon-btn-sm" onClick={() => p.onBrush(sel.id)} aria-label="Кисть и ластик">
                  <Icon name="brush" size={20} />
                </button>
              </>
            )}
            <button className="icon-btn icon-btn-sm" onClick={() => p.onDuplicate(sel.id)} aria-label="Копия">
              <Icon name="copy" size={20} />
            </button>
            <button className="icon-btn icon-btn-sm tool-danger" onClick={() => p.onRemove(sel.id)} aria-label="Удалить слой">
              <Icon name="trash" size={20} />
            </button>
          </div>
          <div className="slider-row">
            <span className="muted small">Прозрачность</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              value={Math.round(sel.opacity * 100)}
              onChange={(e) => p.onUpdate(sel.id, { opacity: Number(e.target.value) / 100 }, false)}
              onPointerUp={() => p.onUpdate(sel.id, {}, true)}
              aria-label="Прозрачность слоя"
            />
            <output className="slider-value">{Math.round(sel.opacity * 100)}</output>
          </div>
        </>
      ) : (
        <p className="muted small">Выберите слой. Двигайте его пальцем, двумя пальцами — увеличивайте и поворачивайте.</p>
      )}

      <button className="btn btn-soft btn-block btn-sm" onClick={p.onMerge} disabled={stack.layers.length < 2}>
        <Icon name="merge" size={18} /> Объединить слои
      </button>
    </div>
  );
}
