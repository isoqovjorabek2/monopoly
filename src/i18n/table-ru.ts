import type { TableDict } from './table-en';

const pl = (n: number, one: string, few: string, many: string): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export const tableRu: TableDict = {
  counter: {
    button: 'Встречное',
    title: (name) => `Встречное предложение игроку ${name}`,
    note: (name) => `Измените что угодно и отправьте обратно. Исходное предложение игрока ${name} при этом отзывается.`,
    send: 'Отправить встречное предложение',
    badge: 'встречное',
  },

  alerts: {
    on: 'Оповещения вкл.',
    off: 'Оповещения выкл.',
    title: 'Сообщать, когда стол ждёт меня, даже из другой вкладки',
    blocked: 'Уведомления для этого сайта запрещены в настройках браузера.',
    yourTurn: 'Ваш ход',
    needed: 'Стол ждёт вашего решения',
    offer: (name) => `${name} присылает вам предложение`,
    request: (name) => `${name} хочет занять место`,
  },

  rematch: {
    again: 'Сыграть ещё раз за этим столом',
    note: 'Все остаются на местах, а правила можно изменить до первого броска.',
    waiting: 'Ждём, пока хозяин начнёт новую игру…',
  },

  live: {
    inProgress: (round) => `Идёт игра · раунд ${round}`,
    openSeats: (n) => `${n} ${pl(n, 'место бота свободно', 'места ботов свободны', 'мест ботов свободно')}`,
    watch: 'Смотреть и войти',
    watchTitle: 'Войдите, наблюдайте и займите место бота',
  },

  log: {
    countered: (by, from) => `${by} делает встречное предложение игроку ${from}.`,
  },
};
