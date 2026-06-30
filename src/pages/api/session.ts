import type { APIRoute } from 'astro';
import { json } from '../../lib/http';

export const GET: APIRoute = ({ locals }) => {
  return json({
    email: locals.translatorEmail,
    login: locals.translatorLogin,
    isReviewer: locals.isReviewer,
  });
};
