import { Suspense, lazy, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useStore } from './store/store';
import { Home } from './ui/Home';
import { Lobby } from './ui/Lobby';
import { Game } from './ui/Game';

/* The Cashflow table is its own chunk: a Monopoly player never downloads
 * it, and the front door does not wait on it either. */
const CashflowGame = lazy(() => import('./ui/cashflow/CashflowGame'));

export default function App() {
  const screen = useStore((s) => s.screen);
  const code = useStore((s) => s.code);
  const kind = useStore((s) => s.room?.kind ?? 'monopoly');

  // Keep the address bar in step so a refresh, a back button, or a copied
  // URL all land somewhere sensible.
  useEffect(() => {
    const want = screen === 'home' ? '' : code ? `#/join/${code}` : '#/play';
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want || window.location.pathname);
    }
  }, [screen, code]);

  // A refresh mid-game cannot be recovered peer-to-peer, so warn first.
  useEffect(() => {
    if (screen !== 'game') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [screen]);

  // Deliberately NOT wrapped in <AnimatePresence mode="wait">. That holds the
  // outgoing screen until its exit animation finishes, and requestAnimationFrame
  // is paused in background tabs - so a host who switched tabs would never
  // actually reach the board. A screen change must never wait on an animation.
  return (
    <motion.div
      key={screen}
      className="screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && kind === 'monopoly' && <Game />}
      {screen === 'game' && kind === 'cashflow' && (
        <Suspense fallback={<div className="cfLoading"><div className="spinner" aria-hidden /></div>}>
          <CashflowGame />
        </Suspense>
      )}
    </motion.div>
  );
}
