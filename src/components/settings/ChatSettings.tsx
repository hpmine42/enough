import { t } from '../../i18n';
import Toggle from '../Toggle';
import { Row, Section } from './settings-ui';

interface ChatSettingsProps {
  enterToSend: boolean;
  setEnterToSend: (value: boolean) => void;
  myNotes: boolean;
  onToggleMyNotes: (on: boolean) => void;
  notesBusy: boolean;
  notesLoading: boolean;
  notesError: string | null;
}

export default function ChatSettings({
  enterToSend,
  setEnterToSend,
  myNotes,
  onToggleMyNotes,
  notesBusy,
  notesLoading,
  notesError,
}: ChatSettingsProps) {
  return (
    <Section title={t('settingsScreen.chat')}>
      <Row label={t('settingsScreen.enterToSend')} sub={t('settingsScreen.enterToSendHint')}>
        <Toggle
          checked={enterToSend}
          onChange={setEnterToSend}
          label={t('settingsScreen.enterToSend')}
        />
      </Row>
      <Row label={t('settingsScreen.myNotes')} sub={t('settingsScreen.myNotesHint')}>
        <Toggle
          checked={myNotes}
          onChange={onToggleMyNotes}
          disabled={notesBusy || notesLoading}
          label={t('settingsScreen.myNotes')}
        />
      </Row>
      {notesError && (
        <p className="error" role="alert">
          {notesError}
        </p>
      )}
    </Section>
  );
}
