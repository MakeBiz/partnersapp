import { deals } from '../../../lib/mock.js';
export const dynamic = 'force-dynamic';
// Демо: комиссии по сделкам из моков (раньше импортировалась несуществующая функция)
export async function GET() {
  return Response.json(deals.map(({ id, client, product, amount, commSum, commStatus }) =>
    ({ id, client, product, amount, commSum: commSum ?? null, commStatus: commStatus ?? null })));
}
