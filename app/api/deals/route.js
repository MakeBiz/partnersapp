import { deals } from '../../../lib/mock.js';
export const dynamic = 'force-dynamic';
export async function GET() { return Response.json(deals); }
