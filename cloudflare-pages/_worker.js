export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return env.HOUSE.fetch(request);
    return env.ASSETS.fetch(request);
  }
};
