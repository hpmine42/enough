import { FormEvent, KeyboardEvent, useRef } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { t } from '../i18n';
import { SendIcon } from './icons';

interface MessageComposerProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

const MAX_LINES = 4;

/**
 * Mobile-first composer. The textarea grows to ~4 lines, then scrolls
 * internally. Enter-to-send is a preference (default OFF: Enter = new line,
 * Shift + Enter = send).
 */
export default function MessageComposer({ onSend, disabled }: MessageComposerProps) {
  const { enterToSend } = usePreferences();
  const textRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 22;
    const maxHeight = lineHeight * MAX_LINES + 20;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function submit() {
    const el = textRef.current;
    if (!el) return;
    const value = el.value.trim();
    if (!value || disabled) return;
    onSend(value);
    el.value = '';
    resize();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        ref={textRef}
        className={`composer-input${disabled ? ' disabled' : ''}`}
        placeholder={t('chat.composerPlaceholder')}
        rows={1}
        onChange={resize}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-label={t('chat.composerPlaceholder')}
        enterKeyHint={enterToSend ? 'send' : 'enter'}
        spellCheck
      />
      <button
        className="send"
        type="submit"
        disabled={disabled}
        aria-label={t('chat.sendLabel')}
      >
        <SendIcon size={19} />
      </button>
    </form>
  );
}
