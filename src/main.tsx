import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PAPER } from './art/art';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { startTelemetry } from './net/telemetry';
import { startHistoryReports } from './net/history';
import { consumeAuthReturn, refreshPass } from './net/account';
import './styles/global.css';
import './styles/board.css';
import './styles/app.css';
import './styles/deals.css';

// The card stock is used by rules in app.css, but its path depends on the
// deploy base, which only exists at runtime. Set once here rather than
// threading an inline style through every card that wants paper under it.
document.documentElement.style.setProperty('--paper-img', `url("${PAPER}")`);

// Coming back from Google: take the pass out of the address bar before
// anything else reads it. The sign-in popup hands it to the page that
// opened it and closes, so it never renders a second copy of the game.
void consumeAuthReturn().then((isPopup) => {
  const root = document.getElementById('root');
  if (!root) return;
  if (isPopup) {
    root.innerHTML = '<p style="font: 15px system-ui, sans-serif; color: #dee5e0; padding: 24px">Signed in. You can close this window.</p>';
    return;
  }
  // Tables tell the operator's panel what they look like. Never blocks play.
  startTelemetry();
  // Finished games go into each signed-in player's history (Party Hall Plus).
  startHistoryReports();
  // A Plus purchase made anywhere shows up here without signing in again.
  void refreshPass();
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
