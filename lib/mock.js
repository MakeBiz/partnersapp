export const partner = { name:'Игорь Соколов', tier:'Голд', status:'Действующий', comm1:20, comm2:10, score:78, refcode:'MKB-IGSK-4213', payout:'На карту', card:'•••• 4213' };
export const deals = [
 {id:1201, client:'ООО «Ромашка»',    product:'OpenClaw',    amount:600000, date:'2026-02-11', reached:4, lost:false, cs:'Выплачена'},
 {id:1204, client:'ООО «Бета Софт»',  product:'IntDoc',      amount:260000, date:'2026-02-27', reached:4, lost:false, cs:'Выплачена'},
 {id:1210, client:'ИП Ветров',        product:'Bitrix24',    amount:350000, date:'2026-03-04', reached:3, lost:false, cs:'Не начислена'},
 {id:1213, client:'ООО «ТехноЛайн»',  product:'Vector',      amount:180000, date:'2026-03-19', reached:3, lost:false, cs:'Не начислена'},
 {id:1218, client:'ООО «Ника»',       product:'Bitrix24',    amount:320000, date:'2026-03-30', reached:4, lost:false, cs:'Выплачена'},
 {id:1223, client:'ООО «Гринфилд»',   product:'BI',          amount:420000, date:'2026-04-08', reached:2, lost:false, cs:'Не начислена'},
 {id:1229, client:'ООО «Скайнет»',    product:'IntDoc',      amount:240000, date:'2026-04-22', reached:4, lost:false, cs:'Выплачена'},
 {id:1235, client:'ИП Соколова',      product:'Bitrix24',    amount:300000, date:'2026-05-02', reached:4, lost:false, cs:'К выплате'},
 {id:1240, client:'ООО «Вектор Плюс»',product:'OpenClaw',    amount:750000, date:'2026-05-14', reached:4, lost:false, cs:'Выплачена'},
 {id:1247, client:'ООО «Ортекс»',     product:'Хостинг/VPS', amount:75000,  date:'2026-06-05', reached:0, lost:true,  cs:'—'},
 {id:1251, client:'ООО «Дельта»',     product:'DronWay',     amount:1200000,date:'2026-06-10', reached:3, lost:false, cs:'Не начислена'},
 {id:1256, client:'ООО «Омега»',      product:'OpenClaw',    amount:540000, date:'2026-06-25', reached:2, lost:false, cs:'Не начислена'},
 {id:1260, client:'ООО «Сигма»',      product:'BI',          amount:380000, date:'2026-07-01', reached:1, lost:false, cs:'Не начислена'},
 {id:1263, client:'ООО «Полюс»',      product:'Vector',      amount:195000, date:'2026-07-05', reached:2, lost:false, cs:'Не начислена'},
 {id:1266, client:'ООО «Меркурий»',   product:'Хостинг/VPS', amount:90000,  date:'2026-07-08', reached:4, lost:false, cs:'К выплате'},
 {id:1201.5, client:'ООО «Альфа Трейд»',product:'Vector',    amount:210000, date:'2026-01-20', reached:1, lost:true,  cs:'—'}
];
const rate = partner.comm1;
export function enrich() {
  return deals.map(function (d) {
    var won = d.reached === 4 && !d.lost;
    return Object.assign({}, d, { won: won, comm: won ? Math.round((d.amount * rate) / 100) : 0 });
  });
}
export function commissions() {
  var e = enrich();
  var paid = e.filter(function (d) { return d.cs === 'Выплачена'; }).reduce(function (a, d) { return a + d.comm; }, 0);
  var payable = e.filter(function (d) { return d.cs === 'К выплате'; }).reduce(function (a, d) { return a + d.comm; }, 0);
  return { summary: { accrued: paid + payable, payable: payable, paid: paid, currency: 'RUB' }, items: e.filter(function (d) { return d.comm > 0; }) };
}
