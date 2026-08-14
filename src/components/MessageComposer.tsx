import { FormEvent, useState } from 'react';

export default function MessageComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
  }

  return (
    <form className="composer" onSubmit={submit}>
      <input
        className="input"
        placeholder="Nachricht"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Nachricht"
        enterKeyHint="send"
      />
      <button
        className="send"
        type="submit"
        disabled={disabled || text.trim() === ''}
        aria-label="Senden"
      >
        ↑
      </button>
    </form>
  );
}
