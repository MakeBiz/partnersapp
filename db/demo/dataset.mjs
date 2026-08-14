/**
 * Демонстрационный набор данных партнёрского кабинета.
 *
 * Сеть из пяти партнёров с двумя уровнями, сделки по всем пяти продуктам,
 * лиды, обучение, выводы и биржа. Начисления по этим данным считаются
 * НАСТОЯЩИМ кодом (lib/commissions.js), а не проставлены руками —
 * поэтому демо всегда согласовано с боевой логикой.
 *
 * Сделки живут в Bitrix, в базе кабинета их нет. Здесь они лежат как
 * фикстура: ими наполняется леджер, и ими же можно подменить ответ
 * gateway для показа кабинета без боевых данных.
 */

// contactId — идентификатор контакта в Bitrix (в демо условный)
export const partners = [
  {
    contactId: 1001, name: 'Андрей Кузнецов', refcode: 'MKB-AKUZ-1001',
    telegramId: '500100001', status: 'Действующий', tier: 'Платина',
    payer: 'ИП', payRatio: 1.0, upline: null,
    note: 'строит сеть: пригласил двоих',
  },
  {
    contactId: 1002, name: 'Игорь Соколов', refcode: 'MKB-ISOK-1002',
    telegramId: '500100002', status: 'Действующий', tier: 'Голд',
    payer: 'Физлицо (карта)', payRatio: 0.8, upline: 1001,
    note: 'основной демо-партнёр: много сделок, выплата на карту',
  },
  {
    contactId: 1003, name: 'Марина Лебедева', refcode: 'MKB-MLEB-1003',
    telegramId: '500100003', status: 'Действующий', tier: 'Сильвер',
    payer: 'Юрлицо', payRatio: 1.0, upline: 1001,
    note: 'работает через юрлицо',
  },
  {
    contactId: 1004, name: 'Дмитрий Орлов', refcode: 'MKB-DORL-1004',
    telegramId: '500100004', status: 'Действующий', tier: 'Голд',
    payer: 'Самозанятый', payRatio: 1.0, upline: 1002,
    note: 'приглашён Игорем — его сделки дают Игорю второй уровень',
  },
  {
    contactId: 1005, name: 'Ольга Рябова', refcode: 'MKB-ORYA-1005',
    telegramId: '500100005', status: 'Действующий', tier: 'Сильвер',
    payer: 'Физлицо (карта)', payRatio: 0.8, upline: 1003,
    note: 'новый партнёр: кабинет есть, сделок ещё нет',
  },
];

const won = (o) => ({ stageId: 'C1:WON', stageName: 'Оплата получена', isWon: true, isLost: false, ...o });
const work = (o) => ({ stageId: 'C1:2', stageName: 'КП / переговоры', isWon: false, isLost: false, commStatus: 'Не начислена', ...o });
const lost = (o) => ({ stageId: 'C1:LOSE', stageName: 'Отказ', isWon: false, isLost: true, commStatus: '—', ...o });

/** Сделки по каждому партнёру (contactId → массив). */
export const dealsByPartner = {
  1001: [
    won({ id: 9001, client: 'ООО «Технопарк»', product: 'Bitrix24 CRM', amount: 550000, createdAt: '2026-01-20', commStatus: 'Выплачена', licDate: '2026-02-01' }),
    won({ id: 9002, client: 'ООО «Севертранс»', product: 'Vector', amount: 210000, createdAt: '2026-04-17', commStatus: 'Выплачена', licDate: '2026-05-01' }),
  ],
  1002: [
    won({ id: 9101, client: 'ООО «Ромашка»', product: 'AI-кастом', amount: 600000, createdAt: '2026-02-11', commStatus: 'Выплачена', licDate: '2026-03-01' }),
    won({ id: 9102, client: 'ООО «Бета Софт»', product: 'IntDoc', amount: 260000, createdAt: '2026-02-27', commStatus: 'Выплачена', licDate: '2026-03-15' }),
    work({ id: 9103, client: 'ИП Ветров', product: 'Bitrix24 CRM', amount: 350000, createdAt: '2026-03-04' }),
    won({ id: 9104, client: 'ООО «Ника»', product: 'Bitrix24 CRM', amount: 320000, createdAt: '2026-03-30', commStatus: 'Выплачена', licDate: '2026-04-10' }),
    work({ id: 9105, client: 'ООО «Гринфилд»', product: 'Оптимизация', amount: 420000, createdAt: '2026-04-08' }),
    won({ id: 9106, client: 'ООО «Скайнет»', product: 'IntDoc', amount: 240000, createdAt: '2026-04-22', commStatus: 'Выплачена', licDate: '2026-05-05' }),
    won({ id: 9107, client: 'ИП Соколова', product: 'Bitrix24 CRM', amount: 300000, createdAt: '2026-05-02', commStatus: 'К выплате' }),
    won({ id: 9108, client: 'ООО «Вектор Плюс»', product: 'AI-кастом', amount: 750000, createdAt: '2026-05-14', commStatus: 'Выплачена', licDate: '2026-06-01' }),
    lost({ id: 9109, client: 'ООО «Ортекс»', product: 'Vector', amount: 75000, createdAt: '2026-06-05' }),
    won({ id: 9110, client: 'ООО «Меркурий»', product: 'Vector', amount: 90000, createdAt: '2026-07-08', commStatus: 'К выплате' }),
    won({ id: 9111, client: 'ООО «Полюс»', product: 'Оптимизация', amount: 195000, createdAt: '2026-07-25', commStatus: 'Не начислена' }),
  ],
  1003: [
    won({ id: 9201, client: 'ООО «Заря»', product: 'Bitrix24 CRM', amount: 480000, createdAt: '2026-03-15', commStatus: 'Выплачена', licDate: '2026-04-01' }),
    won({ id: 9202, client: 'ООО «Стройдом»', product: 'Vector', amount: 150000, createdAt: '2026-06-01', commStatus: 'К выплате' }),
  ],
  1004: [
    won({ id: 9301, client: 'ООО «Аврора»', product: 'AI-кастом', amount: 900000, createdAt: '2026-05-20', commStatus: 'Выплачена', licDate: '2026-06-10' }),
    won({ id: 9302, client: 'ООО «Квант»', product: 'IntDoc', amount: 180000, createdAt: '2026-07-14', commStatus: 'К выплате' }),
  ],
  1005: [],
};

/** Лиды, заведённые партнёрами руками. */
export const leads = [
  { contactId: 1002, clientName: 'ООО «Сигма»', phone: '+79161234501', product: 'bitrix24', status: 'В работе', dupReview: false, daysAgo: 12 },
  { contactId: 1002, clientName: 'ООО «Дельта Про»', phone: '+79161234502', product: 'ai-custom', status: 'Новый', dupReview: false, daysAgo: 5 },
  { contactId: 1002, clientName: 'ИП Красильников', phone: '+79161234503', product: 'vector', status: 'На проверке', dupReview: true, daysAgo: 2, comment: 'клиент уже был в базе — решает менеджер' },
  { contactId: 1004, clientName: 'ООО «Пирамида»', phone: '+79161234504', product: 'intdoc', status: 'Квалифицирован', dupReview: false, daysAgo: 20 },
  { contactId: 1003, clientName: 'ООО «Атлант»', phone: '+79161234505', product: 'optimize', status: 'Новый', dupReview: false, daysAgo: 1 },
];

/** Пройденное обучение (contactId → продукты). */
export const training = {
  1001: ['bitrix24', 'vector', 'ai-custom', 'intdoc', 'optimize'],
  1002: ['bitrix24', 'ai-custom', 'intdoc'],
  1003: ['bitrix24', 'vector'],
  1004: ['ai-custom', 'intdoc'],
  1005: ['bitrix24'],
};

/** Уже проведённые выплаты. */
export const withdrawals = [
  { contactId: 1002, amount: 150000, daysAgo: 42, status: 'Выплачено' },
  { contactId: 1002, amount: 96000, daysAgo: 74, status: 'Выплачено' },
  { contactId: 1001, amount: 110000, daysAgo: 30, status: 'Выплачено' },
  { contactId: 1004, amount: 180000, daysAgo: 21, status: 'Выплачено' },
  { contactId: 1003, amount: 96000, daysAgo: 15, status: 'В обработке' },
];

/** Биржа лидов (распределяет партнёрский менеджер вручную). */
export const exchange = [
  { title: 'Логистическая компания, 40 менеджеров — нужен Bitrix24', description: 'Москва, переезд с самописной CRM. Нужен интегратор с опытом в логистике.', product: 'bitrix24', region: 'Москва', status: 'open' },
  { title: 'Сеть клиник — аналитика звонков', description: 'Контроль качества регистратуры, 12 филиалов.', product: 'vector', region: 'Санкт-Петербург', status: 'open' },
  { title: 'Оптовый поставщик — обработка спецификаций', description: 'Входящие заявки в Excel, нужен разбор и КП.', product: 'intdoc', region: 'Екатеринбург', status: 'assigned', assignedTo: 1004 },
];

/** Начисление баллов за действия (совпадает с таблицей settings). */
export const POINTS = {
  lead_created: 5,
  lead_qualified: 15,
  deal_won: 50,
  training_done: 20,
  partner_activated: 100,
};

export const adminUsers = [
  { login: 'anton', name: 'Антон Чернобаев', role: 'admin' },
  { login: 'assistant', name: 'Ассистент', role: 'assistant' },
];
