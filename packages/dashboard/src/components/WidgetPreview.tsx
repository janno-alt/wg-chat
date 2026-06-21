/**
 * Naturgetreue Vorschau des eingebetteten Widgets (reiner Mock, kein echter Chat).
 * Spiegelt Theme, Begrüßung, Position und Starter-Buttons live aus dem Editor wider.
 */
export function WidgetPreview({
  name,
  greeting,
  primary,
  bubble,
  textColor,
  position,
  buttons,
}: {
  name: string;
  greeting: string;
  primary: string;
  bubble: string;
  textColor: string;
  position: 'bottom-right' | 'bottom-left';
  buttons: string[];
}) {
  const right = position !== 'bottom-left';
  const panelSide = right ? { right: 14 } : { left: 14 };
  const launcherSide = right ? { right: 16 } : { left: 16 };

  return (
    <div
      style={{
        position: 'relative',
        height: 440,
        borderRadius: 12,
        background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ position: 'absolute', top: 12, left: 14, fontSize: 12, color: '#94a3b8' }}>
        Beispielseite
      </div>

      {/* Chat-Panel */}
      <div
        style={{
          position: 'absolute',
          bottom: 78,
          width: 300,
          maxWidth: '88%',
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 12px 40px rgba(0,0,0,.20)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          ...panelSide,
        }}
      >
        <div
          style={{
            background: primary,
            color: textColor,
            padding: '12px 14px',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{name || 'Chat'}</span>
          <span style={{ opacity: 0.85 }}>×</span>
        </div>

        <div style={{ padding: 12, background: '#f7f8fa', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}>
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              background: '#fff',
              border: '1px solid #ececf0',
              borderRadius: 14,
              borderBottomLeftRadius: 4,
              padding: '8px 11px',
              fontSize: 13,
              color: '#111',
            }}
          >
            {greeting || 'Hallo! Wie kann ich helfen?'}
          </div>
        </div>

        {buttons.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 10px', background: '#f7f8fa' }}>
            {buttons.slice(0, 4).map((b, i) => (
              <span
                key={i}
                style={{ border: `1px solid ${primary}`, color: primary, borderRadius: 16, padding: '5px 10px', fontSize: 12 }}
              >
                {b}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #ececf0' }}>
          <div style={{ flex: 1, border: '1px solid #d8d8e0', borderRadius: 20, padding: '8px 12px', fontSize: 13, color: '#9aa3af' }}>
            Nachricht schreiben…
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: primary,
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
            }}
          >
            ➤
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: '#aaa', padding: 5 }}>Powered by wg-chat</div>
      </div>

      {/* Launcher-Bubble */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: bubble,
          color: textColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          boxShadow: '0 6px 20px rgba(0,0,0,.25)',
          ...launcherSide,
        }}
      >
        💬
      </div>
    </div>
  );
}
