import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorReport, logError } from '../app/errors';
import { Icon } from './Icon';

interface Props {
  where: string;
  onHome: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  copied: boolean;
}

/**
 * Если экран упал при отрисовке, показываем понятное окно вместо пустого экрана.
 * Проекты при этом не теряются: они сохраняются на устройстве по мере правок.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError(this.props.where, { message: error.message, stack: (error.stack ?? '') + (info.componentStack ? '\n' + info.componentStack.split('\n').slice(0, 4).join('\n') : '') });
  }

  private copy = async () => {
    const text = errorReport();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      const el = document.getElementById('crash-report') as HTMLTextAreaElement | null;
      el?.select();
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="screen screen-scroll crash">
        <div className="crash-card">
          <span className="crash-icon">
            <Icon name="info" size={28} />
          </span>
          <h1 className="crash-title">Экран не открылся</h1>
          <p className="muted">
            Произошла ошибка. Ваши проекты сохранены на устройстве — попробуйте открыть снова. Если повторяется, скопируйте отчёт и пришлите его.
          </p>
          <p className="crash-message">{error.message || String(error)}</p>
          <div className="crash-actions">
            <button className="btn btn-primary btn-block" onClick={() => this.setState({ error: null })}>
              Попробовать снова
            </button>
            <button className="btn btn-soft btn-block" onClick={this.props.onHome}>
              На главную
            </button>
            <button className="btn btn-soft btn-block" onClick={this.copy}>
              <Icon name={copied ? 'check' : 'text'} size={18} /> {copied ? 'Отчёт скопирован' : 'Скопировать отчёт'}
            </button>
          </div>
          <textarea id="crash-report" className="crash-report" readOnly value={errorReport()} aria-label="Отчёт об ошибке" />
        </div>
      </div>
    );
  }
}
