import type { AccountDict } from './account-en';

const pl = (n: number, one: string, few: string, many: string): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export const accountRu: AccountDict = {
  signIn: 'Войти через Google',
  signingIn: 'Завершите вход в окне Google…',
  signOut: 'Выйти из аккаунта',
  errors: {
    cancelled: 'Вход отменён.',
    failed: 'Google не подтвердил вход. Попробуйте ещё раз.',
    unavailable: 'Вход сейчас недоступен.',
    invalid: 'Не удалось проверить вход. Попробуйте ещё раз.',
    popup: 'Окно входа заблокировано.',
  },
  joinAfterSignIn: (code) => `Войти и присоединиться к ${code}`,

  watching: 'Наблюдение',
  watchingNote: 'Эта игра началась без вас. Займите место бота и продолжайте с того же момента — его деньги, участки и ход станут вашими.',
  takeSeat: (name) => `Играть за ${name}`,
  seatSummary: (cash, deeds) => `${cash} · ${deeds} ${pl(deeds, 'участок', 'участка', 'участков')}`,
  noSeats: 'Все места заняты людьми. Можно наблюдать до конца игры.',
  watchers: (names) => `Наблюдают: ${names}`,

  log: {
    seatTaken: (name, bot) => `${name} занимает место игрока ${bot}.`,
  },
};
