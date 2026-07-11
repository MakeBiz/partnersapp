export const partner = { name: 'Игорь Соколов', tier: 'Голд', status: 'Действующий', comm1: 20, comm2: 10, score: 78, refcode: 'MKB-IGSK-4213' };
export const deals = [
  { id: 1201, client: 'ООО «Ромашка»', product: 'OpenClaw', amount: 600000, stage: 'Оплата получена', comm: 120000, commStatus: 'Выплачена' },
  { id: 1210, client: 'ИП Ветров', product: 'Bitrix24', amount: 350000, stage: 'Внедрение', comm: 0, commStatus: 'Не начислена' },
  { id: 1229, client: 'ООО «Скайнет»', product: 'IntDoc', amount: 240000, stage: 'Оплата получена', comm: 48000, commStatus: 'Выплачена' },
  { id: 1266, client: 'ООО «Меркурий»', product: 'Хостинг/VPS', amount: 90000, stage: 'Оплата получена', comm: 18000, commStatus: 'К выплате' }
];
export function commissions() {
  const paid = deals.filter(d => d.commStatus === 'Выплачена').reduce((a, d) => a + d.comm, 0);
  const payable = deals.filter(d => d.commStatus === 'К выплате').reduce((a, d) => a + d.comm, 0);
  return { summary: { accrued: paid + payable, payable, paid, currency: 'RUB' }, items: deals.filter(d => d.comm > 0) };
}
