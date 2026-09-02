/**
 * Shared layout primitives for the Settings category subpages.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function Row({
  label,
  sub,
  children,
  onClick,
}: {
  label: string;
  sub?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="settings-row-main">
        <div className="settings-row-label">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="settings-row clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="settings-row">{content}</div>;
}
