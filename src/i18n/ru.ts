import type { Messages } from './es';

/** Русские формы множественного числа: 1 партия, 2 партии, 5 партий. */
const pluralRu = new Intl.PluralRules('ru');
const plural = (n: number, one: string, few: string, many: string) => {
  const form = pluralRu.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};

export const ru: Messages = {
  langName: 'Русский',
  pageTitle: 'Шахматный анализ',
  header: {
    title: '♞ Анализ',
    loadingEngine: 'Загрузка движка…',
    engineUnavailable: 'Движок недоступен',
    reset: '↺ Новая партия',
    resetTitle: 'Вернуться к начальной позиции',
    language: 'Язык',
  },
  nav: {
    label: 'Навигация',
    start: 'В начало',
    startKey: 'В начало (Home)',
    prev: 'Предыдущий ход',
    prevKey: 'Предыдущий ход (←)',
    next: 'Следующий ход',
    nextKey: 'Следующий ход (→)',
    end: 'В конец',
    endKey: 'В конец (End)',
    flip: 'Перевернуть доску',
    flipKey: 'Перевернуть доску (F)',
  },
  engine: {
    toggle: 'Движок',
    lines: 'Линии',
    depth: 'Глуб.',
    hint: 'Цвет каждой линии совпадает с цветом её стрелки на доске. Нажмите на линию, чтобы сыграть её первый ход.',
    playLine: 'Сыграть первый ход этой линии',
    calculating: 'Расчёт…',
    stats: (depth, nps, nodes) => `глуб. ${depth} · ${nps} узл/с · ${nodes} узлов`,
  },
  opening: { title: 'Дебют (база Lichess)' },
  moves: { label: 'Ходы' },
  status: {
    whiteMates: 'Мат: победа белых',
    blackMates: 'Мат: победа чёрных',
    stalemate: 'Ничья: пат',
    insufficient: 'Ничья: недостаточно материала',
    threefold: 'Ничья: троекратное повторение',
    fiftyMoves: 'Ничья (правило 50 ходов)',
  },
  review: {
    title: 'Оценка последнего хода (по критериям chess.com)',
    classes: {
      book: 'Теория', best: 'Лучший', excellent: 'Отлично', good: 'Хорошо',
      inaccuracy: 'Неточность', mistake: 'Ошибка', blunder: 'Зевок',
    },
    verdict: {
      book: '— теоретический ход', best: '— лучший ход', excellent: '— отличный ход', good: '— хороший ход',
      inaccuracy: '— неточность', mistake: '— ошибка', blunder: '— зевок',
    },
    bestWas: (san) => `Лучше было ${san}`,
    evalChange: (before, after) => `Оценка ${before} → ${after}`,
    pending: (san) => `Оцениваю ${san}…`,
    engineOff: 'Включите движок, чтобы оценивать ходы.',
  },
  promotion: { label: 'Выберите фигуру для превращения', q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' },
  io: {
    summary: 'Вставить FEN или PGN / экспорт',
    load: 'Загрузить',
    pgnPlaceholder: 'Вставьте PGN сюда',
    loadPgn: 'Загрузить PGN',
    copyPgn: 'Копировать PGN',
    pgnReadError: (url, err) => `Не удалось прочитать PGN из ${url}: ${err}`,
  },
  banner: { advance: 'нажимайте ▶, чтобы идти дальше', original: 'оригинал ↗' },
  importer: {
    title: 'Импорт моих партий',
    stepsHtml:
      '1. Выберите, где вы играете · 2. Введите <b>имя пользователя</b> · 3. Нажмите <b>Найти</b> и выберите партию для анализа. ' +
      'Пароль не нужен: читаются только ваши открытые партии.',
    site: 'Сайт',
    yourUser: 'Ваше имя пользователя на',
    placeholder: 'напр. MagnusCarlsen',
    search: 'Найти мои партии',
    searching: 'Поиск…',
    needUser: (site) => `Введите имя пользователя на ${site}.`,
    downloading: (site) => `Загрузка ваших последних партий с ${site}…`,
    found: (n) =>
      `${plural(n, 'Найдена', 'Найдены', 'Найдено')} ${n} ${plural(n, 'партия', 'партии', 'партий')}. Выберите партию для анализа.`,
    none: 'У этого пользователя нет недавних партий в классические шахматы.',
    network: (site) => `Не удалось подключиться к ${site}. Проверьте соединение и не блокирует ли запрос блокировщик контента.`,
    win: 'Победа',
    loss: 'Поражение',
    draw: 'Ничья',
    asWhite: '⚪ Белые',
    asBlack: '⚫ Чёрные',
    analyze: 'Анализ ›',
    speeds: {
      ultraBullet: 'ультрапуля', bullet: 'пуля', blitz: 'блиц', rapid: 'рапид',
      classical: 'классика', daily: 'по переписке', correspondence: 'по переписке',
    },
    errors: {
      invalidUser: 'Недопустимое имя пользователя (2–30 символов: буквы, цифры, _ или -).',
      notFound: (user) => `Пользователь «${user}» не найден или у него нет открытых партий.`,
      rateLimited: 'Слишком много запросов: сервер просит подождать. Попробуйте через минуту.',
      http: (status) => `Ошибка сервера ${status} при загрузке партий.`,
      unexpected: (site) => `Неожиданный ответ от ${site}.`,
    },
  },
};
