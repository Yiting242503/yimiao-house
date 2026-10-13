import worker from './worker.js';

// An independent host must never trust Sites identity headers or preview cookies.
export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, AUTH_PROVIDER: 'supabase', LOCAL_PREVIEW: undefined }, ctx);
  }
};
