import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PAPER } from './art/art';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/global.css';
import './styles/board.css';
import './styles/app.css';

// The card stock is used by rules in app.css, but its path depends on the
// deploy base, which only exists at runtime. Set once here rather than
// threading an inline style through every card that wants paper under it.
document.documentElement.style.setProperty('--paper-img', `url("${PAPER}")`);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
