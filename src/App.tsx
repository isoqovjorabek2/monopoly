import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store/store';
import { Home } from './ui/Home';
import { Lobby } from './ui/Lobby';
import { Game } from './ui/Game';

export default function App() {
  const screen = useStore((s) => s.screen);
  const code = useStore((s) => s.code);

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

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        className="screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {screen === 'home' && <Home />}
        {screen === 'lobby' && <Lobby />}
        {screen === 'game' && <Game />}
      </motion.div>
    </AnimatePresence>
  );
}
