import { partner } from '../../../lib/mock.js';
export const dynamic = 'force-dynamic';
export async function GET() { return Response.json({ code: partner.refcode, url: 'https://makebiz.ru/?ref=' + partner.refcode }); }
